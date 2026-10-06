import { DEFAULT_PORT, type ServerToClient } from '@browsagent/shared';

import { Overlay } from './overlay.js';
import { collectRecords, collectStamps } from './register.js';

export interface ClientOptions {
  /** The address of the index service. */
  server?: string;
  /** The project name. */
  project?: string;
}

function serverUrl(options: ClientOptions): string {
  if (options.server) return options.server;
  const fromWindow = (window as unknown as { __BROWSAGENT_SERVER__?: string })
    .__BROWSAGENT_SERVER__;
  return fromWindow ?? `ws://localhost:${DEFAULT_PORT}`;
}

function projectName(options: ClientOptions): string {
  return options.project ?? window.location.host;
}

/**
 * Start the client.
 *
 * Phase 1: the client sends the stamps and the live records to the server.
 * Phase 2: the user points at an element and writes a problem.
 */
export function boot(options: ClientOptions = {}): void {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const overlay = new Overlay({
    onSelect: (node) => {
      overlay.stop();
      const position = node.getAttribute('data-src') ?? 'no source stamp';
      const problem = window.prompt(
        `Problem for <${node.tagName.toLowerCase()}> at ${position}:`,
      );
      if (!problem) return;
      const inst = node.getAttribute('data-inst');
      if (!inst) return;
      socket?.send(
        JSON.stringify({
          kind: 'mark',
          inst,
          problem: {
            type: 'layout',
            severity: 'medium',
            text: problem,
            expected: null,
            propagate: 'auto',
            viewports: [],
          },
        }),
      );
    },
  });

  const connect = (): void => {
    const url = serverUrl(options);
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      socket?.send(
        JSON.stringify({
          kind: 'hello',
          project: projectName(options),
          route: window.location.pathname,
        }),
      );
      socket?.send(
        JSON.stringify({
          kind: 'register',
          stamps: collectStamps(document),
          records: collectRecords(document),
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      let message: ServerToClient;
      try {
        message = JSON.parse(String(event.data)) as ServerToClient;
      } catch {
        return;
      }
      if (message.kind === 'indexed') {
        console.info(`[browsagent] indexed ${message.count} nodes`);
      }
      if (message.kind === 'error') {
        console.warn(`[browsagent] ${message.message}`);
      }
    });

    socket.addEventListener('close', () => {
      if (reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1500);
    });
  };

  connect();

  window.addEventListener('keydown', (event) => {
    if (event.key === 'm' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
      event.preventDefault();
      overlay.toggle();
    }
  });

  (window as unknown as { browsagent?: unknown }).browsagent = { overlay, boot };
}

boot();
