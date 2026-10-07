import {
  STAMP,
  type ElementState,
  type RuntimeRecord,
  type SourcePosition,
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
  return { name: 'current', width: window.innerWidth, height: window.innerHeight };
}

/** Read one source position from a stamp value. */
function parsePosition(value: string | null): SourcePosition | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length < 3) return null;
  const column = Number(parts[parts.length - 1]);
  const line = Number(parts[parts.length - 2]);
  const file = parts.slice(0, -2).join(':');
  if (Number.isNaN(line) || Number.isNaN(column)) return null;
  return { file, line, column };
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

function componentName(node: Element): string | null {
  return node.closest('[data-component]')?.getAttribute('data-component') ?? null;
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

/** Read the static data of one node. Null if the node has no stamp. */
export function readStamp(node: Element): StaticStamp | null {
  const src = parsePosition(node.getAttribute(STAMP.src));
  if (!src) return null;
  const parentElement = node.parentElement;
  return {
    src,
    component: componentName(node),
    expressions: readExpressions(node),
    editable: !src.file.includes('node_modules'),
    parentSrc: parentElement ? parsePosition(parentElement.getAttribute(STAMP.src)) : null,
    inst: instanceId(node),
  };
}

/** Read the live data of one node. */
export function readRecord(node: Element): RuntimeRecord {
  return {
    inst: instanceId(node),
    values: readValues(node),
    state: readState(node),
    viewport: readViewport(),
  };
}

/** Collect the static data of every node with a stamp. */
export function collectStamps(root: ParentNode): StaticStamp[] {
  const stamps: StaticStamp[] = [];
  for (const node of root.querySelectorAll(`[${STAMP.src}]`)) {
    const stamp = readStamp(node);
    if (stamp) stamps.push(stamp);
  }
  return stamps;
}

/** Collect the live data of every node with a stamp. */
export function collectRecords(root: ParentNode): RuntimeRecord[] {
  const records: RuntimeRecord[] = [];
  for (const node of root.querySelectorAll(`[${STAMP.src}]`)) {
    records.push(readRecord(node));
  }
  return records;
}
