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
  | { kind: 'error'; message: string }
  | { kind: 'status' };

/**
 * The messages from the worker to the content script and the panel.
 *
 * The `overlay` message sets the overlay state. It does not toggle the state.
 */
export type FromBackground =
  | { kind: 'overlay'; active: boolean }
  | { kind: 'status'; connected: boolean; server: string; queued: number }
  | { kind: 'selected'; selection: Selection }
  | { kind: 'error'; message: string };
