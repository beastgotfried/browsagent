import type {
  ElementRecord,
  RuntimeRecord,
  StaticStamp,
  Task,
} from './types.js';

/** The messages from the client to the server. */
export type ClientToServer =
  | {
      kind: 'hello';
      project: string;
      route: string;
    }
  | {
      kind: 'register';
      stamps: StaticStamp[];
      records: RuntimeRecord[];
    }
  | {
      kind: 'mark';
      inst: string;
      problem: Task['problem'];
    };

/** The messages from the server to the client. */
export type ServerToClient =
  | { kind: 'indexed'; count: number }
  | { kind: 'record'; record: ElementRecord }
  | { kind: 'task'; task: Task }
  | { kind: 'error'; message: string };

/** The name of the stamp attributes. The plugin and the client share them. */
export const STAMP = {
  src: 'data-src',
  expr: 'data-src-expr',
  inst: 'data-inst',
} as const;

/** The default port of the index service. */
export const DEFAULT_PORT = 4517;
