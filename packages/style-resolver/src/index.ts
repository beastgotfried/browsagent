import type { StyleRule } from '@browsagent/shared';

/**
 * A small part of the Chrome DevTools Protocol.
 * Only the calls that this package needs.
 */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface CssSourceRange {
  startLine: number;
  startColumn: number;
}

interface CssValue {
  text: string;
}

interface CssProperty {
  name: string;
  value: string;
  important: boolean;
  disabled: boolean;
  implicit: boolean;
}

interface MatchedRule {
  rule: {
    selectorList: { text: string };
    origin: string;
    style: { cssProperties: CssProperty[] };
    styleSheetId?: string;
    media?: unknown[];
  };
  matchingSelectors: number[];
}

interface MatchedStyles {
  matchedCSSRules?: MatchedRule[];
  inherited?: Array<{ matchedCSSRules?: MatchedRule[] }>;
}

interface CssLocation {
  startLine: number;
  startColumn: number;
}

function specificity(selector: string): string {
  const id = (selector.match(/#[\w-]+/g) ?? []).length;
  const cls = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g) ?? []).length;
  const tag = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return `${id}-${cls}-${tag}`;
}

function toRule(matched: MatchedRule, source: CssSourceRange | null): StyleRule {
  const selector = matched.rule.selectorList.text;
  const properties: Record<string, string> = {};
  for (const property of matched.rule.style.cssProperties) {
    if (property.disabled) continue;
    properties[property.name] = property.value;
  }
  return {
    src: source
      ? { file: '', line: source.startLine + 1, column: source.startColumn + 1 }
      : null,
    selector,
    specificity: specificity(selector),
    origin: matched.rule.origin,
    properties,
    winner: true,
    reason: null,
  };
}

/**
 * Find the CSS rules that hit one element.
 *
 * The resolver uses the Chrome DevTools Protocol. The protocol gives the
 * matched rules, the origin, and the source position. A rule that comes from
 * CSS-in-JS has no source position. Then `src` is null.
 */
export class StyleResolver {
  constructor(private readonly session: CdpSession) {}

  /** Find the rules for one element. The selector must find one node. */
  async resolve(selector: string): Promise<StyleRule[]> {
    const document = (await this.session.send('DOM.getDocument', {
      depth: 1,
    })) as { root: { nodeId: number } };

    const found = (await this.session.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector,
    })) as { nodeId: number };

    if (!found.nodeId) return [];

    const matched = (await this.session.send('CSS.getMatchedStylesForNode', {
      nodeId: found.nodeId,
    })) as MatchedStyles;

    const rules: StyleRule[] = [];
    for (const entry of matched.matchedCSSRules ?? []) {
      rules.push(toRule(entry, null));
    }
    for (const inherited of matched.inherited ?? []) {
      for (const entry of inherited.matchedCSSRules ?? []) {
        const rule = toRule(entry, null);
        rule.reason = 'inherited from a parent element';
        rules.push(rule);
      }
    }
    return rules;
  }
}

/** Get the source position of one stylesheet rule. */
export async function ruleSource(
  session: CdpSession,
  styleSheetId: string,
  range: CssSourceRange,
): Promise<CssLocation | null> {
  try {
    const result = (await session.send('CSS.getStyleSheetText', {
      styleSheetId,
    })) as { text: string };
    if (!result.text) return null;
    const lines = result.text.split('\n');
    const line = lines[range.startLine] ?? '';
    return { startLine: range.startLine, startColumn: Math.min(range.startColumn, line.length) };
  } catch {
    return null;
  }
}
