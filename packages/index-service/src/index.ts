import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  DEFAULT_PORT,
  type ClientToServer,
  type ElementRecord,
  type Problem,
  type Selection,
  type ServerToClient,
  type Task,
} from '@browsagent/shared';
import { StyleResolver } from '@browsagent/style-resolver';

import { Index, TaskStore } from './store.js';

export interface ServiceOptions {
  port?: number;
  /** The project name. */
  project: string;
  /** The current commit. */
  commit: string;
  /** A function to get the CSS rules of one node. Can be null in a test. */
  styles?: (inst: string) => Promise<ElementRecord['styles']>;
  /** A function to find all use sites of one component. */
  useSites?: (component: string | null) => Promise<ElementRecord['useSites']>;
}

function send(socket: WebSocket, message: ServerToClient): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** The problem that the user gives before the editor exists. */
export const NO_PROBLEM: null = null;

/**
 * Phase 2 of the pipeline.
 *
 * The service does four jobs:
 * 1. It stores the stamps and the live records of a registered tab.
 * 2. It joins the two sides of one mark into one record.
 * 3. It adds the style data and the use sites.
 * 4. It makes a structured task when the mark carries a problem.
 */
export class IndexService {
  private readonly index = new Index();
  private readonly tasks = new TaskStore();
  private readonly clients = new Set<WebSocket>();
  private http: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;

  constructor(private readonly options: ServiceOptions) {}

  get taskStore(): TaskStore {
    return this.tasks;
  }

  /**
   * Join one mark into one record.
   *
   * The stamp is the static side. The record is the live side. The service
   * does not read the page again. Therefore a worker restart, a dropped
   * socket, or a page reload cannot change the result.
   */
  async recordFrom(selection: Selection): Promise<ElementRecord> {
    const { stamp, record } = selection;

    const styles = this.options.styles ? await this.options.styles(stamp.inst) : [];
    const useSites = this.options.useSites
      ? await this.options.useSites(stamp.component)
      : [];

    const confidence: ElementRecord['confidence'] =
      styles.length > 0 ? 'high' : 'medium';

    return {
      inst: stamp.inst,
      src: stamp.src,
      component: stamp.component,
      expressions: stamp.expressions,
      values: record.values,
      state: record.state,
      viewport: record.viewport,
      editable: stamp.editable,
      parentSrc: stamp.parentSrc,
      styles,
      useSites,
      confidence,
    };
  }

  /** Make one task for one agent. */
  makeTask(record: ElementRecord, problem: Problem): Task {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      project: this.options.project,
      route: record.src.file,
      commit: this.options.commit,
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
   * A mark without a problem answers with the record. The problem editor does
   * not exist yet. A mark with a problem answers with a task.
   */
  async acceptMark(
    selection: Selection,
    problem: Problem | null,
  ): Promise<ServerToClient> {
    const record = await this.recordFrom(selection);
    if (problem === null) return { kind: 'record', record };

    const task = this.makeTask(record, problem);
    this.tasks.put(task);
    return { kind: 'task', task };
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
      void this.acceptMark(message.selection, message.problem).then((answer) => {
        for (const client of this.clients) send(client, answer);
      });
    }
  }

  async listen(): Promise<number> {
    const port = this.options.port ?? DEFAULT_PORT;

    this.http = createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.url === '/tasks') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(this.tasks.all()));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.on('message', (data) => {
        try {
          this.handle(socket, JSON.parse(String(data)) as ClientToServer);
        } catch {
          send(socket, { kind: 'error', message: 'bad message' });
        }
      });
      socket.on('close', () => this.clients.delete(socket));
    });

    await new Promise<void>((resolve) => this.http?.listen(port, resolve));
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
