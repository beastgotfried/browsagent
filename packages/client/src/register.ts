import {
  STAMP,
  type ElementState,
  type RuntimeRecord,
  type StaticStamp,
  type Viewport,
} from '@browsagent/shared';

let counter = 0;

/** Get the instance identity of one node. Make one if it is absent. */
export function instanceId(node: Element): string {
  const existing = node.getAttribute(STAMP.inst);
  if (existing) return existing;
  counter += 1;
  const id = `i${counter.toString(36)}`;
  node.setAttribute(STAMP.inst, id);
  return id;
}

/** Read the interaction state of one node. */
export function readState(node: Element): ElementState {
  return {
    hover: node.matches(':hover'),
    focus: node.matches(':focus') || node.matches(':focus-within'),
    active: node.matches(':active'),
    open: node.matches('[open]') || node.getAttribute('aria-expanded') === 'true',
    disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true',
  };
}

/** Read the size of the browser. */
export function readViewport(): Viewport {
  return {
    name: 'current',
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function readExpressions(node: Element): Record<string, string> {
  const raw = node.getAttribute(STAMP.expr);
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, string>;
    }
  } catch {
    return {};
  }
  return {};
}

function parsePosition(value: string | null): { file: string; line: number; column: number } | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length < 3) return null;
  const column = Number(parts[parts.length - 1]);
  const line = Number(parts[parts.length - 2]);
  const file = parts.slice(0, -2).join(':');
  if (Number.isNaN(line) || Number.isNaN(column)) return null;
  return { file, line, column };
}

function componentName(node: Element): string | null {
  const value = node.closest('[data-component]');
  return value?.getAttribute('data-component') ?? null;
}

/** Read the evaluated value of one node. */
function readValues(node: Element): Record<string, string> {
  const values: Record<string, string> = {};
  const classValue = node.getAttribute('class');
  if (classValue) values['className'] = classValue;
  const styleValue = node.getAttribute('style');
  if (styleValue) values['style'] = styleValue;
  return values;
}

/** Collect the static data of every node with a stamp. */
export function collectStamps(root: ParentNode): StaticStamp[] {
  const stamps: StaticStamp[] = [];
  for (const node of root.querySelectorAll(`[${STAMP.src}]`)) {
    const src = parsePosition(node.getAttribute(STAMP.src));
    if (!src) continue;
    const parentElement = node.parentElement;
    const parentSrc = parentElement
      ? parsePosition(parentElement.getAttribute(STAMP.src))
      : null;
    stamps.push({
      src,
      component: componentName(node),
      expressions: readExpressions(node),
      editable: !src.file.includes('node_modules'),
      parentSrc,
      inst: instanceId(node),
    });
  }
  return stamps;
}

/** Collect the live data of every node with a stamp. */
export function collectRecords(root: ParentNode): RuntimeRecord[] {
  const records: RuntimeRecord[] = [];
  for (const node of root.querySelectorAll(`[${STAMP.src}]`)) {
    records.push({
      inst: instanceId(node),
      values: readValues(node),
      state: readState(node),
      viewport: readViewport(),
    });
  }
  return records;
}
