import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  DEFAULT_PORT,
  type AcceptResult,
  type ClientToServer,
  type ElementRecord,
  type Problem,
  type ProjectContext,
  type ProviderState,
  type RuntimeRecord,
  type Selection,
  type ServerToClient,
  type Task,
  type TaskState,
} from '@browsagent/shared';
import { StyleResolver } from '@browsagent/style-resolver';

import { Index, TaskStore } from './store.js';

/** The address of the companion. A local tool listens on the loopback only. */
const HOST = '127.0.0.1';

/**
 * The states of a task that a repair still uses. The service does not accept
 * such a task: the accept step removes the worktree that the repair runs in.
 */
const RUNNING_STATES: ReadonlySet<TaskState> = new Set([
  'queued',
  'working',
  'waiting',
  'verifying',
]);

export interface ServiceOptions {
  port?: number;
  /** The project name. */
  project: string;
  /** A function that returns the current commit. The service calls it for each task. */
  commit: () => string;
  /**
   * The shared token. The service refuses a socket and a request that holds a
   * different token. The service answers every caller when the value is absent.
   */
  token?: string;
  /** A function to get the CSS rules of one node. Can be null in a test. */
  styles?: (inst: string) => Promise<ElementRecord['styles']>;
  /** A function to find all use sites of one component. */
  useSites?: (component: string | null) => Promise<ElementRecord['useSites']>;
  /** The repair of one new task. The service sends the answer to every client. */
  onTask?: (task: Task) => Promise<Task>;
  /** The context pass. The service sends the result to every client. */
  onContext?: () => Promise<ProjectContext | null>;
  /** The accept step. It applies the diff of one task to the working tree. */
  onAccept?: (task: Task) => Promise<AcceptResult>;
  /** The project context and its staleness. The service sends this on connect. */
  contextState?: () => { context: ProjectContext | null; stale: boolean };
  /**
   * The provider state for the panel. Null when the companion did not wire
   * the provider. The type has no field for the key.
   */
  providerState?: () => ProviderState | null;
}

function send(socket: WebSocket, message: ServerToClient): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** The words of one rejected hook. This function never throws. */
function faultWords(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The companion hook failed with no message.';
}

/** The problem that the user gives before the editor exists. */
export const NO_PROBLEM: null = null;

/**
 * Phase 2 of the pipeline.
 *
 * The service does these jobs:
 * 1. It stores the stamps and the live records of a registered tab.
 * 2. It joins the two sides of one mark into one record.
 * 3. It adds the style data and the use sites.
 * 4. It makes a structured task when the mark carries a problem.
 * 5. It gives each new task to the repair hook and sends the answer to the panel.
 * 6. It runs the accept step and the context pass when a client asks.
 * 7. It serves GET /tasks and GET /state.
 */
export class IndexService {
  private readonly index = new Index();
  private readonly tasks = new TaskStore();
  private readonly clients = new Set<WebSocket>();
  private http: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  /** True while one context pass runs. A second pass must not overlap the first. */
  private contextPassRunning = false;

  constructor(private readonly options: ServiceOptions) {}

  get taskStore(): TaskStore {
    return this.tasks;
  }

  /** Send one message to every connected client. */
  private broadcast(message: ServerToClient): void {
    for (const client of this.clients) send(client, message);
  }

  /**
   * Join one mark into one record.
   *
   * The stamp is the static side. The record is the live side. Both come from
   * the mark. The service reads the page only for the style data, when a
   * style callback is set. Therefore a dropped socket or a page reload cannot
   * change the stamp or the live record.
   */
  async recordFrom(selection: Selection): Promise<ElementRecord> {
    const { stamp } = selection;
    // The message comes from a socket. A bad client can send no live record.
    const record: RuntimeRecord | null = selection.record;

    const styles = this.options.styles ? await this.options.styles(stamp.inst) : [];
    const useSites = this.options.useSites
      ? await this.options.useSites(stamp.component)
      : [];

    // The confidence measures the trust in the source position. A node with a
    // style rule from the style callback is certain. A node with no live
    // record or no source file has no certain position. The value does not
    // count the style rules.
    const confidence: ElementRecord['confidence'] =
      record === null || stamp.src.file.trim() === ''
        ? 'low'
        : styles.length > 0
          ? 'high'
          : 'medium';

    return {
      inst: stamp.inst,
      src: stamp.src,
      component: stamp.component,
      expressions: stamp.expressions,
      values: record?.values ?? {},
      state: record?.state ?? {
        hover: false,
        focus: false,
        active: false,
        open: false,
        disabled: false,
      },
      viewport: record?.viewport ?? { name: 'unknown', width: 0, height: 0 },
      editable: stamp.editable,
      parentSrc: stamp.parentSrc,
      styles,
      useSites,
      confidence,
    };
  }

  /** Make one task for one agent. The route is the address of the marked page. */
  makeTask(record: ElementRecord, problem: Problem, route: string): Task {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      project: this.options.project,
      route,
      commit: this.options.commit(),
      problem,
      record,
      state: 'queued',
      plan: null,
      files: [],
      cost: 0,
      tries: 0,
      diff: null,
      evidence: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Take one mark.
   *
   * A mark without a problem answers with the record.
   *
   * A mark with a problem makes one task. The service puts the task in the
   * store and sends it to every client at once, in the queued state. It then
   * gives the task to the repair hook. It sends the task again when the hook
   * returns a different one. The answer is null in this case: the clients
   * already have the task.
   */
  async acceptMark(
    selection: Selection,
    problem: Problem | null,
  ): Promise<ServerToClient | null> {
    const record = await this.recordFrom(selection);
    if (problem === null) return { kind: 'record', record };

    // The route is the page that the user marked. The source file lives in the
    // record. The page address is the value that the panel shows.
    const route = selection.tabUrl.trim() === '' ? record.src.file : selection.tabUrl;
    const task = this.makeTask(record, problem, route);
    this.tasks.put(task);
    this.broadcast({ kind: 'task', task });

    const hook = this.options.onTask;
    if (hook === undefined) {
      // A task must not stay in the queued state without a hook to run it.
      this.failTask(task);
      this.broadcast({
        kind: 'error',
        message: 'The repair hook is not set. The tool made no repair.',
      });
      return null;
    }

    let repaired: Task;
    try {
      repaired = await hook(task);
    } catch (error) {
      // The task is stored. A fault must move it out of the queued state, so
      // the panel does not show a task that never moves.
      this.failTask(task);
      throw error;
    }
    this.tasks.put(repaired);
    if (repaired !== task) this.broadcast({ kind: 'task', task: repaired });
    return null;
  }

  /** Move one task to the failed state. The service sends the changed task. */
  private failTask(task: Task): Task {
    const failed: Task = {
      ...task,
      state: 'failed',
      updatedAt: new Date().toISOString(),
    };
    this.tasks.put(failed);
    this.broadcast({ kind: 'task', task: failed });
    return failed;
  }

  /** Apply the patch of one accepted task. The answer goes to every client. */
  private async acceptTask(task: Task): Promise<void> {
    const hook = this.options.onAccept;
    if (hook === undefined) {
      throw new Error('The accept hook is not set. The tool did not apply the patch.');
    }
    const result = await hook(task);
    this.broadcast({ kind: 'accepted', result, task });
  }

  /** Run one context pass. The answer goes to every client. */
  private async runContextPass(): Promise<void> {
    const hook = this.options.onContext;
    if (hook === undefined) {
      throw new Error('The context hook is not set. The tool made no context.');
    }
    const context = await hook();
    const state = this.options.contextState?.();
    // A null answer keeps the context that the companion already holds.
    this.broadcast({
      kind: 'context',
      context: context ?? state?.context ?? null,
      stale: state?.stale ?? false,
    });
  }

  private handle(socket: WebSocket, message: ClientToServer): void {
    if (message.kind === 'hello') {
      this.index.clear();
      send(socket, { kind: 'indexed', count: 0 });
      return;
    }

    if (message.kind === 'register') {
      this.index.setStamps(message.stamps);
      this.index.setRecords(message.records);
      send(socket, { kind: 'indexed', count: this.index.size });
      return;
    }

    if (message.kind === 'mark') {
      void this.acceptMark(message.selection, message.problem)
        .then((answer) => {
          if (answer !== null) this.broadcast(answer);
        })
        .catch((error: unknown) => {
          this.broadcast({ kind: 'error', message: faultWords(error) });
        });
      return;
    }

    if (message.kind === 'accept') {
      const task = this.tasks.get(message.taskId);
      if (task === null) {
        send(socket, {
          kind: 'error',
          message: `The store holds no task ${message.taskId}.`,
        });
        return;
      }
      if (RUNNING_STATES.has(task.state)) {
        // A running repair uses the worktree. An accept now removes it.
        send(socket, {
          kind: 'error',
          message:
            `The task ${message.taskId} is in the "${task.state}" state. ` +
            'The tool accepts a task that stopped.',
        });
        return;
      }
      void this.acceptTask(task).catch((error: unknown) => {
        this.broadcast({ kind: 'error', message: faultWords(error) });
      });
      return;
    }

    if (message.kind === 'recontext') {
      if (this.contextPassRunning) {
        // Two passes write the same two files. One pass at a time keeps the
        // document and the record in step.
        send(socket, {
          kind: 'error',
          message: 'A context pass is already running. Wait for the answer.',
        });
        return;
      }
      this.contextPassRunning = true;
      void this.runContextPass()
        .catch((error: unknown) => {
          this.broadcast({ kind: 'error', message: faultWords(error) });
        })
        .finally(() => {
          this.contextPassRunning = false;
        });
    }
  }

  /** True when the request carries the shared token. True when no token is set. */
  private tokenOk(request: IncomingMessage): boolean {
    const token = this.options.token;
    if (token === undefined || token === '') return true;
    if (request.headers['x-browsagent-token'] === token) return true;
    const given = new URL(request.url ?? '/', `http://${HOST}`).searchParams.get('token');
    return given === token;
  }

  async listen(): Promise<number> {
    const port = this.options.port ?? DEFAULT_PORT;

    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      // The client must give the shared token. Without this check any page or
      // process can read the tasks and spend the key of the user.
      if (!this.tokenOk(request)) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'The token is absent or wrong.' }));
        return;
      }
      // The path holds no query string. The token sits in the query string.
      const path = (request.url ?? '/').split('?')[0] ?? '/';
      if (path === '/tasks') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(this.tasks.all()));
        return;
      }
      if (path === '/state') {
        const provider = this.options.providerState?.() ?? null;
        const context = this.options.contextState?.() ?? null;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ provider, context, tasks: this.tasks.all().length }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    this.http = server;

    this.wss = new WebSocketServer({
      server,
      // The socket carries the same token. The path /mark?token=... holds it.
      verifyClient: (info: { req: IncomingMessage }) => this.tokenOk(info.req),
    });
    // The server reports the fault of one client. It must not stop the process.
    this.wss.on('error', () => undefined);
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);

      const state = this.options.contextState?.();
      if (state !== undefined) {
        send(socket, { kind: 'context', context: state.context, stale: state.stale });
      }
      send(socket, { kind: 'indexed', count: this.index.size });

      socket.on('message', (data) => {
        try {
          this.handle(socket, JSON.parse(String(data)) as ClientToServer);
        } catch {
          send(socket, { kind: 'error', message: 'bad message' });
        }
      });
      // A bad frame emits an error on the socket. An error with no listener
      // stops the whole companion. Close the one socket instead.
      socket.on('error', () => socket.close());
      socket.on('close', () => this.clients.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // The loopback address only. No other machine reaches the companion.
      server.listen(port, HOST, () => resolve());
    });
    return port;
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.close();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.http?.close(() => resolve()));
  }
}

export { StyleResolver };
export { Index, TaskStore } from './store.js';
