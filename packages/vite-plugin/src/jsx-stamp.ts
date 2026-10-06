import path from 'node:path';

import type { PluginObj, PluginPass } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import type { JSXAttribute, JSXOpeningElement } from '@babel/types';

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

/**
 * A Babel plugin.
 *
 * The plugin adds the source stamp to each JSX element. The plugin also keeps
 * the expression text of each dynamic property. The expression text is the
 * important part for a value such as `cn("px-4", big && "mt-2")`.
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
