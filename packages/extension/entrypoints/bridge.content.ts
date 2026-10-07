import { defineContentScript } from 'wxt/utils/define-content-script';

import type { SourcePosition } from '@browsagent/shared';

import { isProbeRequest, PROBE_ATTR, type ProbeResult } from '../src/bus.js';

/**
 * The page bridge.
 *
 * The content script runs in an isolated world. It cannot read the JavaScript
 * objects of the page. This script runs in the MAIN world. It can read the
 * React fiber of a node. The content script asks for one node with a
 * ProbeRequest. This script answers with a ProbeResult.
 *
 * The React debug data exists in a development build only. In a production
 * build every read fails. The bridge then answers with two null values.
 */

/** The debug data of one React fiber. React writes it in development. */
interface FiberSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/** One node of the React fiber tree. */
interface Fiber {
  type?: unknown;
  return?: Fiber | null;
  _debugSource?: FiberSource | null;
  _debugOwner?: Fiber | null;
}

/** The reading of one node. */
interface ProbeReading {
  component: string | null;
  src: SourcePosition | null;
}

/** Read the name of one React type. A type is a function or a wrapper object. */
function typeName(type: unknown): string | null {
  if (typeof type === 'function') {
    const fn = type as { displayName?: unknown; name?: unknown };
    if (typeof fn.displayName === 'string') return fn.displayName;
    if (typeof fn.name === 'string' && fn.name !== '') return fn.name;
    return null;
  }
  if (typeof type === 'object' && type !== null) {
    const wrapper = type as { displayName?: unknown; render?: unknown };
    if (typeof wrapper.displayName === 'string') return wrapper.displayName;
    return typeName(wrapper.render);
  }
  return null;
}

/** Read the name of the component that made one fiber. */
function componentName(fiber: Fiber): string | null {
  const owner = fiber._debugOwner;
  if (owner !== undefined && owner !== null) {
    const name = typeName(owner.type);
    if (name !== null) return name;
  }
  return typeName(fiber.type);
}

/** Read the React fiber of one DOM node. Null if the node has no fiber. */
function readFiber(node: Element): Fiber | null {
  const record = node as unknown as Record<string, unknown>;
  const key = Object.keys(record).find((name) => name.startsWith('__reactFiber$'));
  if (key === undefined) return null;
  const fiber: unknown = record[key];
  return typeof fiber === 'object' && fiber !== null ? (fiber as Fiber) : null;
}

/**
 * Read the source position and the component of one DOM node.
 *
 * Walk up the fiber tree to the nearest fiber with _debugSource or
 * _debugOwner. Return null on any failure. Never throw into the page.
 */
function readNode(node: Element): ProbeReading | null {
  try {
    let fiber = readFiber(node);
    while (fiber !== null) {
      const source = fiber._debugSource;
      if (source !== undefined && source !== null) {
        const src: SourcePosition = {
          file: String(source.fileName),
          line: Number(source.lineNumber),
          column: Number(source.columnNumber),
        };
        return { component: componentName(fiber), src };
      }
      if (fiber._debugOwner !== undefined && fiber._debugOwner !== null) {
        return { component: componentName(fiber), src: null };
      }
      fiber = fiber.return ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Find the node of one probe request. Read it. Post the answer. */
function answer(token: string): void {
  const node = document.querySelector(`[${PROBE_ATTR}="${token}"]`);
  const reading = node === null ? null : readNode(node);
  const result = {
    source: 'browsagent',
    kind: 'probe-result',
    token,
    component: reading === null ? null : reading.component,
    src: reading === null ? null : reading.src,
  } satisfies ProbeResult;
  window.postMessage(result, '*');
}

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_idle',
  world: 'MAIN',

  main() {
    window.addEventListener('message', (event: MessageEvent) => {
      try {
        if (event.source !== window) return;
        const data: unknown = event.data;
        if (!isProbeRequest(data)) return;
        answer(data.token);
      } catch {
        // Never throw into the page.
      }
    });
  },
});
