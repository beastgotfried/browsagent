import type {
  ElementRecord,
  Selection,
  SourcePosition,
} from '@browsagent/shared';

// The mark shape is part of the wire protocol. The extension and the
// companion use the same type from the shared package.
export type { Selection };

/** The messages from the content script and the panel to the worker. */
export type ToBackground =
  | { kind: 'toggle-overlay' }
  | { kind: 'selected'; selection: Selection }
  | { kind: 'error'; message: string }
  | { kind: 'status' }
  | { kind: 'overlay-state'; active: boolean };

/**
 * The messages from the worker to the content script and the panel.
 *
 * The `overlay` message sets the overlay state. It does not toggle the state.
 * The `overlay-query` message asks the content script for the live overlay
 * state. The content script answers with `{ kind: 'overlay-state', active }`.
 */
export type FromBackground =
  | { kind: 'overlay'; active: boolean }
  | { kind: 'overlay-query' }
  | { kind: 'status'; connected: boolean; server: string; queued: number }
  | { kind: 'selected'; selection: Selection }
  | { kind: 'record'; record: ElementRecord }
  | { kind: 'error'; message: string };

/**
 * The page bridge protocol.
 *
 * The content script runs in an isolated world. It cannot read the JavaScript
 * objects of the page. The bridge runs in the MAIN world. It can read the React
 * fiber of a node. The two scripts talk in the page with window.postMessage.
 *
 * The exchange for one element:
 * 1. The content script makes a random token.
 * 2. The content script sets the attribute PROBE_ATTR on the node.
 * 3. The content script posts a ProbeRequest.
 * 4. The bridge reads the node and posts a ProbeResult.
 * 5. The content script removes the attribute. A 300 ms timeout guards a
 *    missing answer.
 */

/** The attribute that carries the probe token of one node. */
export const PROBE_ATTR = 'data-browsagent-probe';

/** The time to wait for a probe result, in milliseconds. */
export const PROBE_TIMEOUT_MS = 300;

/** The message from the content script to the bridge. */
export interface ProbeRequest {
  source: 'browsagent';
  kind: 'probe';
  token: string;
}

/** The message from the bridge to the content script. */
export interface ProbeResult {
  source: 'browsagent';
  kind: 'probe-result';
  token: string;
  /** The component that made the node. Null if the bridge found none. */
  component: string | null;
  /** The source position of the node. Null if the bridge found none. */
  src: SourcePosition | null;
}

/** Make a random probe token. */
export function createProbeToken(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True for a probe request. */
export function isProbeRequest(value: unknown): value is ProbeRequest {
  if (!isRecord(value)) return false;
  return (
    value['source'] === 'browsagent' &&
    value['kind'] === 'probe' &&
    typeof value['token'] === 'string'
  );
}

function isSourcePosition(value: unknown): value is SourcePosition {
  if (!isRecord(value)) return false;
  return (
    typeof value['file'] === 'string' &&
    typeof value['line'] === 'number' &&
    typeof value['column'] === 'number'
  );
}

/**
 * True for a probe result. The check rejects malformed data. It cannot keep a
 * page message out of the stamp: the page hears the request and the token.
 */
export function isProbeResult(value: unknown): value is ProbeResult {
  if (!isRecord(value)) return false;
  if (value['source'] !== 'browsagent') return false;
  if (value['kind'] !== 'probe-result') return false;
  if (typeof value['token'] !== 'string') return false;
  if (value['component'] !== null && typeof value['component'] !== 'string') {
    return false;
  }
  return value['src'] === null || isSourcePosition(value['src']);
}
