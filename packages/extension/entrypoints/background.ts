import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import type { ClientToServer, Task } from '@browsagent/shared';

import type { FromBackground, Selection, ToBackground } from '../src/bus.js';
import {
  getServer,
  getToken,
  QUEUED_MARKS_LIMIT,
  queuedMarksItem,
} from '../src/config.js';

/**
 * True for a message that the panel can read.
 *
 * The companion is a different program. A frame from it is not trusted. The
 * worker checks the kind before it forwards the frame.
 */
function isFromBackground(value: unknown): value is FromBackground {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'indexed') return typeof (value as { count?: unknown }).count === 'number';
  return (
    kind === 'overlay' ||
    kind === 'overlay-query' ||
    kind === 'status' ||
    kind === 'selected' ||
    kind === 'record' ||
    kind === 'error' ||
    kind === 'task' ||
    kind === 'task-list' ||
    kind === 'accepted' ||
    kind === 'context'
  );
}

/**
 * The address of the companion for HTTP reads.
 *
 * The saved address starts with ws or wss. The `fetch` function needs http or
 * https. A trailing slash must go.
 */
function httpBase(server: string): string {
  return server.trim().replace(/\/+$/, '').replace(/^ws/, 'http');
}

/**
 * The background service worker.
 *
 * Its jobs:
 * 1. Hold the WebSocket to the local companion.
 * 2. Reconnect when the socket closes.
 * 3. Route the messages between the content script, the panel, and the socket.
 * 4. Answer the `toggle-overlay` command.
 * 5. Ask the active tab for the live overlay state before each change.
 */
export default defineBackground(() => {
  let socket: WebSocket | null = null;
  // True while open() waits for the server address and the token. The flag
  // blocks a second call in that window.
  let opening = false;
  let connected = false;
  let server = '';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  // The marks that wait for a live socket. This array is a copy of the storage
  // item. Each change writes the storage item.
  let queue: unknown[] = [];
  // The last selection of the page. A mark can arrive while the panel is
  // closed. The worker keeps the selection, so the next panel can give it a
  // problem.
  let lastSelection: Selection | null = null;

  // Load the queue before the worker opens a socket or takes a new message.
  // Without the wait an early message and the load can overwrite each other.
  // A failed load must not erase the saved marks. No write runs before a
  // successful load.
  let queueLoaded = false;
  const queueReady: Promise<void> = queuedMarksItem
    .getValue()
    .then((saved) => {
      queue = saved.slice(-QUEUED_MARKS_LIMIT);
      queueLoaded = true;
    })
    .catch(() => undefined);

  // The writes run in sequence. A slow write cannot overwrite a new one.
  let queueWrite: Promise<void> = Promise.resolve();

  const saveQueue = (): void => {
    // A failed load keeps the saved marks. Do not overwrite them.
    if (!queueLoaded) return;
    queueWrite = queueWrite
      .then(() => queuedMarksItem.setValue(queue.slice()))
      .catch(() => undefined);
  };

  const toPanel = (message: FromBackground): void => {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  };

  const send = (message: unknown): void => {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    void queueReady.then(() => {
      queue.push(message);
      // The queue has a cap. Drop the oldest mark when the cap is reached.
      if (queue.length > QUEUED_MARKS_LIMIT) {
        queue.splice(0, queue.length - QUEUED_MARKS_LIMIT);
      }
      saveQueue();
    });
  };

  /** Send one message when the socket is open. Return false when it is not. */
  const sendNow = (message: ClientToServer): boolean => {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  /**
   * Read the task list from the companion.
   *
   * The socket carries the tasks of later marks only. This read gives the
   * tasks that the companion already holds. Therefore a panel that opens after
   * the connect shows every task.
   */
  const loadTasks = async (): Promise<void> => {
    try {
      const token = await getToken();
      const reply = await fetch(
        `${httpBase(server)}/tasks?token=${encodeURIComponent(token)}`,
      );
      if (!reply.ok) return;
      toPanel({ kind: 'task-list', tasks: (await reply.json()) as Task[] });
    } catch {
      // The socket still carries the new tasks. A failed read is not fatal.
    }
  };

  const status = (): void => {
    toPanel({ kind: 'status', connected, server, queued: queue.length });
  };

  // Send the marks that wait in the queue. The worker removes a mark after the
  // send call. A worker stop can send a mark again, but it cannot drop it.
  const flushQueue = async (ws: WebSocket): Promise<void> => {
    while (
      queue.length > 0 &&
      socket === ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(JSON.stringify(queue[0]));
      queue.shift();
      saveQueue();
    }
    status();
  };

  // One reconnect only. The timer is the guard. The error handler and the
  // close event ask for the same reconnect.
  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoff = Math.min(backoff * 2, 15000);
      void open().then((madeSocket) => {
        // open() returns no socket when the old socket is still CONNECTING or
        // CLOSING. Arm the next try. The timer must not run out.
        if (!madeSocket && !connected && reconnectTimer === null) {
          scheduleReconnect();
        }
      });
    }, backoff);
  };

  // True when this call makes the socket. A call that returns early makes no
  // socket. The reconnect timer uses the value.
  const open = async (): Promise<boolean> => {
    // Exactly one socket. Stop when a socket is in the CONNECTING or OPEN
    // state, when a reconnect waits in the timer, or when an earlier open()
    // call is between its awaits.
    if (opening) return false;
    if (socket !== null && socket.readyState !== WebSocket.CLOSED) return false;
    if (reconnectTimer !== null) return false;

    opening = true;
    try {
      await queueReady;
      server = await getServer();
      const token = await getToken();
      const url = `${server}/mark?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(url);
      socket = ws;

      ws.addEventListener('open', () => {
        if (socket !== ws) return;
        connected = true;
        backoff = 1000;
        void flushQueue(ws).catch(() => undefined);
        void loadTasks();
      });

      ws.addEventListener('message', (event) => {
        if (socket !== ws) return;
        try {
          const data: unknown = JSON.parse(String(event.data));
          // Forward one checked frame only. A broken payload must not reach
          // the panel.
          if (!isFromBackground(data)) {
            toPanel({ kind: 'error', message: 'the companion sent bad data' });
            return;
          }
          toPanel(data);
        } catch {
          toPanel({ kind: 'error', message: 'the companion sent bad data' });
        }
      });

      ws.addEventListener('close', () => {
        if (socket !== ws) return;
        socket = null;
        connected = false;
        status();
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        if (socket !== ws) return;
        connected = false;
        status();
        // A failed socket can stay half-open. Close it. The close event and
        // this call make exactly one reconnect.
        ws.close();
        scheduleReconnect();
      });
      return true;
    } catch (error) {
      // The address can be bad. A WebSocket needs a ws, wss, http, or https
      // scheme. Report the error and try again later.
      const detail = error instanceof Error ? error.message : String(error);
      toPanel({ kind: 'error', message: `The socket did not open: ${detail}` });
      scheduleReconnect();
      return false;
    } finally {
      opening = false;
    }
  };

  // Ask the active tab for the live overlay state. Send the opposite value.
  // The state lives in the tab. Therefore a worker restart, a page load, or an
  // Escape press cannot make the two sides disagree.
  const toggleOverlay = async (): Promise<void> => {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;

    const answer = await browser.tabs
      .sendMessage<FromBackground, ToBackground | undefined>(tab.id, {
        kind: 'overlay-query',
      })
      .catch(() => undefined);
    // No state answer means no content script in the tab. Nothing can change
    // there.
    if (answer?.kind !== 'overlay-state') return;

    const active = !answer.active;
    await browser.tabs
      .sendMessage(tab.id, { kind: 'overlay', active } satisfies FromBackground)
      .catch(() => undefined);
  };

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-overlay') void toggleOverlay();
  });

  // The toolbar icon is the primary control. One click opens the side panel and
  // changes the overlay state in the active tab. A click cannot conflict with a
  // browser shortcut. The action has no popup, so onClicked fires.
  browser.action.onClicked.addListener((tab) => {
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    void toggleOverlay();
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const typed = message as ToBackground;

    if (typed.kind === 'status-request') {
      // Answer after the queue load. The count must include the saved marks.
      void queueReady.then(() => {
        sendResponse({ kind: 'status', connected, server, queued: queue.length });
      });
      // A panel can open after the socket connect. That panel missed the
      // task-list message. Read the list again for this panel.
      void loadTasks();
      // A mark can arrive while the panel is closed. Send the last selection,
      // so the new panel can give it a problem.
      if (lastSelection !== null) toPanel({ kind: 'selected', selection: lastSelection });
      return true;
    }

    if (typed.kind === 'toggle-overlay') {
      void toggleOverlay();
      return false;
    }

    if (typed.kind === 'selected') {
      const selection: Selection = typed.selection;
      lastSelection = selection;
      // A click alone carries no problem. Send a null problem, so the
      // companion answers with the record. The editor sends the problem later
      // in a send-mark message.
      send({
        kind: 'mark',
        selection,
        problem: null,
      } satisfies ClientToServer);
      return false;
    }

    if (typed.kind === 'send-mark') {
      // The panel holds the problem text. The worker holds the socket. The
      // queue keeps the mark when the socket is closed.
      lastSelection = typed.selection;
      send({
        kind: 'mark',
        selection: typed.selection,
        problem: typed.problem,
      } satisfies ClientToServer);
      // Answer the panel. Chrome closes the message port when the listener
      // returns false with no answer, and the panel then reports a failed
      // send for a mark that is in the queue.
      sendResponse({ kind: 'status', connected, server, queued: queue.length });
      return false;
    }

    if (typed.kind === 'accept') {
      // An accept is a command, not a mark. Do not queue it. A late apply
      // would change the tree at the wrong time.
      if (!sendNow({ kind: 'accept', taskId: typed.taskId })) {
        toPanel({
          kind: 'error',
          message: 'The companion is offline. The accept did not run.',
        });
      }
      return false;
    }

    if (typed.kind === 'recontext') {
      if (!sendNow({ kind: 'recontext' })) {
        toPanel({
          kind: 'error',
          message: 'The companion is offline. The context pass did not run.',
        });
      }
      return false;
    }

    return false;
  });

  void open();
  // The first status must show the saved marks. Wait for the queue load.
  void queueReady.then(() => {
    status();
    // Report a failed load after the first status. The status would hide the
    // error.
    if (!queueLoaded) {
      toPanel({ kind: 'error', message: 'The saved marks did not load.' });
    }
  });

  // MV3 workers sleep. This alarm wakes the worker and repairs a dead socket.
  // Chrome before version 120 clamps a shorter period to 1 minute. A 1 minute
  // period is correct on every supported version.
  browser.alarms.create('browsagent-keepalive', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'browsagent-keepalive') return;
    if (!connected) void open();
  });
});
