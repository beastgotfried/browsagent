import type {
  AcceptResult,
  ElementRecord,
  Problem,
  ProjectContext,
  RuntimeRecord,
  Selection,
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
      /**
       * Fill the index for one tab.
       *
       * No sender uses this message yet. It is the path for the step that
       * needs the whole page, such as the reuse map. The mark message does not
       * need it: the mark carries its own element.
       */
      kind: 'register';
      stamps: StaticStamp[];
      records: RuntimeRecord[];
    }
  | {
      /**
       * One marked element. The message carries the stamp and the live record.
       * The companion does not keep a copy of the page. Therefore a worker
       * restart or a dropped socket cannot lose the data.
       *
       * `problem` is null while the problem editor does not exist. The
       * companion then answers with the record and makes no task.
       */
      kind: 'mark';
      selection: Selection;
      problem: Problem | null;
    }
  | {
      /** The user accepts the diff of one task. The tool applies the patch. */
      kind: 'accept';
      /** The identity of the task. */
      taskId: string;
    }
  | {
      /** The user asks for a new context pass. */
      kind: 'recontext';
    };

/** The messages from the server to the client. */
export type ServerToClient =
  | { kind: 'indexed'; count: number }
  | { kind: 'record'; record: ElementRecord }
  | { kind: 'task'; task: Task }
  | { kind: 'error'; message: string }
  | {
      /** The project context. Null before the first context pass. */
      kind: 'context';
      context: ProjectContext | null;
      /** True when the context commit is not the current commit. */
      stale: boolean;
    }
  | {
      /** The tool applied the patch of one task to the working tree. */
      kind: 'accepted';
      result: AcceptResult;
      task: Task;
    };

/** The name of the stamp attributes. The plugin and the client share them. */
export const STAMP = {
  src: 'data-src',
  expr: 'data-src-expr',
  inst: 'data-inst',
  component: 'data-component',
} as const;

/** The default port of the index service. */
export const DEFAULT_PORT = 4517;
