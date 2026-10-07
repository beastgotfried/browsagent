import path from 'node:path';

import type { PluginObj, PluginPass } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import type { JSXAttribute, JSXElement, JSXOpeningElement } from '@babel/types';

import { STAMP } from '@browsagent/shared';

export interface JsxStampState {
  root: string;
}

/** The Babel types object. The plugin uses it to make new nodes. */
type BabelTypes = typeof import('@babel/types');

function attributeName(attribute: JSXOpeningElement['attributes'][number]): string | null {
  if (attribute.type !== 'JSXAttribute') return null;
  const name = (attribute as JSXAttribute).name;
  if (name.type !== 'JSXIdentifier') return null;
  return name.name;
}

/** True when the name is a component name. A component name starts uppercase. */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Read the name of the function that holds this path.
 *
 * The name comes from three places: the function declaration, the variable that
 * holds the function, or an assignment target. A plain callback has no name.
 */
function declaredName(fnPath: NodePath): string | null {
  const node = fnPath.node;
  if (node.type === 'FunctionDeclaration' && node.id) {
    return node.id.name;
  }

  const parent = fnPath.parentPath;
  if (parent === null) return null;

  if (parent.isVariableDeclarator()) {
    const id = parent.node.id;
    if (id.type === 'Identifier') return id.name;
  }
  if (parent.isAssignmentExpression()) {
    const left = parent.node.left;
    if (left.type === 'Identifier') return left.name;
  }
  return null;
}

/**
 * True when this element is the value that the function gives back.
 *
 * A component has one root element. The root is the element inside the return
 * statement, or the body of a short arrow function. A child element fails this
 * test, so the walk stops at the root.
 */
function isReturnedRoot(elementPath: NodePath<JSXElement>): boolean {
  const owner = elementPath.parentPath;
  if (owner === null) return false;
  if (owner.isReturnStatement()) return true;
  if (owner.isArrowFunctionExpression()) return owner.node.body === elementPath.node;
  return false;
}

/**
 * A Babel plugin.
 *
 * The plugin adds two attributes to the development build:
 *
 * 1. `data-src`      the source position of the element.
 * 2. `data-component` the name of the component that made the element. The
 *    attribute goes on the root element of the component only.
 *
 * The plugin also keeps the expression text of each dynamic property. The
 * expression text is the important part for a value such as
 * `cn("px-4", big && "mt-2")`.
 */
export function jsxStamp(
  babel: { types: BabelTypes },
  state: JsxStampState,
): PluginObj<PluginPass> {
  const t = babel.types;

  return {
    name: 'browsagent-jsx-stamp',
    visitor: {
      JSXOpeningElement(nodePath: NodePath<JSXOpeningElement>, pluginPass: PluginPass) {
        const node = nodePath.node;
        const filename = pluginPass.file.opts.filename;
        const start = node.loc?.start;
        if (!filename || !start) return;

        const names = new Set(
          node.attributes
            .map(attributeName)
            .filter((name): name is string => name !== null),
        );

        // The component boundary. The finder walks up to the nearest boundary,
        // so a repair lands on the component that owns the element.
        if (!names.has(STAMP.component)) {
          const elementPath = nodePath.parentPath;
          if (elementPath !== null && elementPath.isJSXElement() && isReturnedRoot(elementPath)) {
            const fnPath = nodePath.getFunctionParent();
            if (fnPath !== null) {
              const name = declaredName(fnPath);
              if (name !== null && isComponentName(name)) {
                node.attributes.push(
                  t.jsxAttribute(t.jsxIdentifier(STAMP.component), t.stringLiteral(name)),
                );
                names.add(STAMP.component);
              }
            }
          }
        }

        if (names.has(STAMP.src)) return;

        const rel = path.relative(state.root, filename);
        const position = `${rel}:${start.line}:${start.column + 1}`;

        // The expression text of each dynamic property.
        const expressions: Record<string, string> = {};
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute') continue;
          if (attribute.name.type !== 'JSXIdentifier') continue;
          const name = attribute.name.name;
          if (name.startsWith('data-')) continue;
          if (!attribute.value || attribute.value.type !== 'JSXExpressionContainer') continue;
          const expression = attribute.value.expression;
          const raw = pluginPass.file.code.slice(expression.start ?? 0, expression.end ?? 0);
          if (raw) expressions[name] = raw;
        }

        node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier(STAMP.src), t.stringLiteral(position)),
        );

        if (Object.keys(expressions).length > 0) {
          // The value holds JSON text. A JSX expression container is necessary
          // here. A plain string attribute cannot hold quote characters.
          node.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier(STAMP.expr),
              t.jsxExpressionContainer(t.stringLiteral(JSON.stringify(expressions))),
            ),
          );
        }
      },
    },
  };
}
