import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import type { FromBackground, Selection, ToBackground } from '../src/bus.js';
import { getServer, getToken } from '../src/config.js';

/**
 * The background service worker.
 *
 * Its jobs:
 * 1. Hold the WebSocket to the local companion.
 * 2. Reconnect when the socket closes.
 * 3. Route the messages between the content script, the panel, and the socket.
 * 4. Answer the `toggle-overlay` command.
 * 5. Hold the overlay state of each tab.
 */
export default defineBackground(() => {
  let socket: WebSocket | null = null;
  let connected = false;
  let server = '';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  const queue: unknown[] = [];
  // The tab ids whose overlay is on. The worker owns this state. Therefore
  // every `overlay` message carries the next state and not a toggle.
  const overlayTabs = new Set<number>();

  const toPanel = (message: FromBackground): void => {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  };

  const send = (message: unknown): void => {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    queue.push(message);
  };

  const status = (): void => {
    toPanel({ kind: 'status', connected, server, queued: queue.length });
  };

  const open = async (): Promise<void> => {
    server = await getServer();
    const token = await getToken();
    const url = `${server}/mark?token=${encodeURIComponent(token)}`;

    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      connected = true;
      backoff = 1000;
      while (queue.length > 0) {
        const next = queue.shift();
        socket?.send(JSON.stringify(next));
      }
      status();
    });

    socket.addEventListener('message', (event) => {
      try {
        toPanel(JSON.parse(String(event.data)) as FromBackground);
      } catch {
        toPanel({ kind: 'error', message: 'the companion sent bad data' });
      }
    });

    socket.addEventListener('close', () => {
      connected = false;
      status();
      if (reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(backoff * 2, 15000);
        void open();
      }, backoff);
    });

    socket.addEventListener('error', () => {
      connected = false;
      status();
    });
  };

  const toggleOverlay = async (): Promise<void> => {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;

    const active = !overlayTabs.has(tab.id);
    if (active) overlayTabs.add(tab.id);
    else overlayTabs.delete(tab.id);

    await browser.tabs
      .sendMessage(tab.id, { kind: 'overlay', active } satisfies FromBackground)
      .catch(() => undefined);
  };

  // The content script stops the overlay before it reports a selection or an
  // error without a stamp. Forget the state of that tab.
  const forgetOverlay = (tabId: number | undefined): void => {
    if (tabId === undefined) return;
    overlayTabs.delete(tabId);
  };

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-overlay') void toggleOverlay();
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const typed = message as ToBackground;

    if (typed.kind === 'status') {
      sendResponse({ kind: 'status', connected, server, queued: queue.length });
      return true;
    }

    if (typed.kind === 'toggle-overlay') {
      void toggleOverlay();
      return true;
    }

    if (typed.kind === 'selected') {
      const selection: Selection = typed.selection;
      send({ kind: 'mark', ...selection });
      forgetOverlay(sender.tab?.id);
      return true;
    }

    if (typed.kind === 'error') {
      forgetOverlay(sender.tab?.id);
      return true;
    }

    return undefined;
  });

  void open();
  status();

  // MV3 workers sleep. This alarm wakes the worker and repairs a dead socket.
  browser.alarms.create('browsagent-keepalive', { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'browsagent-keepalive') return;
    if (!connected) void open();
  });
});
