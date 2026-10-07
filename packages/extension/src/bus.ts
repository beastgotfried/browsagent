import type { RuntimeRecord, StaticStamp } from '@browsagent/shared';

/** One marked element before the user writes the problem. */
export interface Selection {
  stamp: StaticStamp;
  record: RuntimeRecord;
  tabUrl: string;
}

/** The messages from the content script and the panel to the worker. */
export type ToBackground =
  | { kind: 'toggle-overlay' }
  | { kind: 'selected'; selection: Selection }
  | { kind: 'status' };

/** The messages from the worker to the content script and the panel. */
export type FromBackground =
  | { kind: 'overlay'; active: boolean }
  | { kind: 'status'; connected: boolean; server: string; queued: number }
  | { kind: 'selected'; selection: Selection }
  | { kind: 'error'; message: string };

/** True when a value has the shape of a background message. */
export function isFromBackground(value: unknown): value is FromBackground {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === 'overlay' ||
    kind === 'status' ||
    kind === 'selected' ||
    kind === 'error'
  );
}
