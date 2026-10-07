# @browsagent/extension

The browser extension. It marks an element on a page and sends the record to
the local companion.

## The manifest

WXT makes the manifest. There is no `manifest.json` in the source. The manifest
comes from `wxt.config.ts` and from the entrypoints. The output goes to
`.output/chrome-mv3/manifest.json`.

## The permission list

The list is narrow on purpose. Read this table before you add a permission.

| Permission | Why |
|---|---|
| `alarms` | Wake the worker. The worker repairs a dead socket. |
| `storage` | Keep the server address and the token. |
| `sidePanel` | WXT adds this because the `sidepanel` entrypoint exists. |

WXT adds `tabs` to the development manifest. The hot reload uses it. The
production manifest does not hold it.

The permissions `activeTab` and `scripting` are absent. No code uses them yet.
The step that adds the content script on demand must add them.

The host list holds the development hosts only:

```
http://localhost/*
http://127.0.0.1/*
```

The content script runs on the same two hosts. Do not add `<all_urls>`.

## The permission we do NOT have

The `debugger` permission is absent. The style finder needs it. Add it as an
**optional** permission in the step that makes the style finder. Ask for it at
run time, not at install time.

Reason: the `debugger` permission is global. It lets the extension attach to
any tab and read the page. A per-site list in the browser UI does not stop it.
Therefore the user must turn it on with a clear action.

## The overlay message contract

The `overlay` message sets the state. The message is not a toggle.

The content script owns the live overlay state. The overlay stops itself when
the user presses Escape. A page load makes a new content script. Therefore the
state of a tab can change without a message to the worker. The worker asks the
tab for the state before each change:

```ts
{ kind: 'overlay-query' }                  // the worker asks
{ kind: 'overlay-state', active: boolean } // the content script answers
```

The worker then sends the opposite value to the tab:

```ts
{ kind: 'overlay', active: boolean }
```

A `true` value starts the overlay. A `false` value stops the overlay. The
content script obeys the value.

The worker accepts a request for a change in one of three ways:

1. A click on the toolbar icon. This is the primary control. One click opens
   the side panel and changes the overlay state. A click cannot conflict with a
   browser shortcut.
2. The `toggle-overlay` command. The suggested key is `Ctrl+Shift+E`
   (`Command+Shift+E` on macOS).
3. A `{ kind: 'toggle-overlay' }` message.

Do not use `Command+Shift+M`. It is the Chrome profile switcher on macOS.
The user can change the key at `chrome://extensions/shortcuts`.

The side panel does not send the message yet.

The worker reads the live state before each change. Therefore a worker
restart, a page load, or an Escape press cannot make the two sides disagree.

## The socket lifecycle

The worker holds one WebSocket to the local companion. The address is the
stored server, the path `/mark`, and the token:

```
<server>/mark?token=<token>
```

The default server is `ws://127.0.0.1:4517`.

### The single-socket guard

The `open()` function must not make a second socket. Three guards stop a
second call:

- The flag `opening` is true. An earlier call waits between its awaits.
- The socket is in the `CONNECTING` or the `OPEN` state.
- A reconnect waits in the timer.

The worker keeps one reconnect timer. The `error` event and the `close` event
ask for the same reconnect. The `error` handler closes a half-open socket. The
`close` event then calls `scheduleReconnect` again. The timer guard makes
exactly one reconnect.

### The persisted queue

The worker holds the marks that wait for a live socket. The queue is a copy of
the storage item `local:queued-marks`. Therefore the queue survives a worker
stop.

The worker loads the queue before it opens a socket or takes a new message
(`queueReady`). Without that wait, an early message and the load can overwrite
each other.

The writes run in sequence. A slow write cannot overwrite a new one. The cap
is `QUEUED_MARKS_LIMIT`, 100 marks. The queue drops the oldest mark at the cap.
A failed load keeps the saved marks. The worker does not write the queue
before a successful load.

`flushQueue` sends the marks in order. The worker removes a mark after its
send call. A worker stop can send a mark again. It cannot drop a mark.

### The reconnect

The backoff starts at 1000 ms and doubles to a maximum of 15000 ms. A
successful open resets the backoff to 1000 ms. The timer is the only guard.
`scheduleReconnect` returns while the timer exists. When the timer cannot make
a socket, it arms the next try. Therefore the timer never runs out.

### The alarm

An MV3 worker sleeps. The alarm `browsagent-keepalive` wakes the worker every
minute. When the socket is not connected, the worker calls `open()` and
repairs it. Chrome before version 120 clamps a shorter period to one minute. A
period of one minute is correct on every supported version.

The panel asks for `{ kind: 'status-request' }`. The request and the report
are two different kinds, so one panel never reads the request of another panel
as its own state. The worker answers after the queue load:

```ts
{ kind: 'status', connected: boolean, server: string, queued: number }
```

The worker keeps the last selection. The answer to the request carries the
selection again, so a panel that opens after a mark can give that mark a
problem. The panel joins the task list of the worker with the tasks that the
socket already delivered. The newer value of each identity wins.

## The MAIN-world page bridge

The content script runs in an isolated world. It cannot read the JavaScript
objects of the page. The bridge runs in the MAIN world. It can read the React
fiber of a node. The two scripts talk in the page with `window.postMessage`.
The bridge is the entrypoint `entrypoints/bridge.content.ts`. It has
`world: 'MAIN'`.

### The probe protocol

The exchange for one element:

1. The content script makes a random token (`crypto.randomUUID`).
2. The content script sets the attribute `data-browsagent-probe` on the node.
   The value is the token.
3. The content script posts a probe request:
   `{ source: 'browsagent', kind: 'probe', token }`.
4. The bridge finds the node with the token. The bridge reads the node. The
   bridge posts an answer:
   `{ source: 'browsagent', kind: 'probe-result', token, component, src }`.
5. The content script removes the attribute. It accepts an answer only when
   the token matches and the source is `browsagent`. The type checks reject
   malformed data. They do not authenticate the page. The page hears the
   request and the token. Therefore a page can post a forged answer. The
   stamp trusts the page, as the DOM stamp (`data-src`) does.
6. A timer of 300 ms (`PROBE_TIMEOUT_MS`) answers `null`. A missing answer is
   not an error.

### The fiber fallback

The content script asks the bridge only when the node has no stamp attribute
(`data-src`, `data-src-expr`, `data-inst`). The bridge reads the key
`__reactFiber$...` on the node. It walks up the fiber tree with `return` to
the nearest fiber with `_debugSource` or `_debugOwner`. It reads the component
name and the source position. It never throws into the page.

The React debug data exists in a development build only. In a production
build every read fails. The bridge then answers two null values. The content
script makes a static stamp from the answer: `expressions: {}`,
`parentSrc: null`, `editable: false` for a file in `node_modules`, and `inst`
from the node. When the answer has no source, the content script reports
`This element has no source stamp.` It does not guess.

## The mark message

The worker sends one mark for each selected element:

```
{ kind: 'mark', selection, problem }
```

`selection` holds `stamp`, `record`, and `tabUrl`. The type is `Selection` in
`@browsagent/shared`. The extension and the companion use the same type.

The mark carries the whole element. The companion does not keep a copy of the
page. Therefore a worker restart, a dropped socket, or a page reload cannot
lose the data.

A click sends `problem: null`. The companion then answers with the record and
makes no task. The side panel sends the problem text from its form with a
`send-mark` message. A mark with a problem answers with a task.

The companion answers on the same socket:

| Answer | Meaning |
|---|---|
| `{ kind: 'record', record }` | The mark had no problem. The record is ready. |
| `{ kind: 'task', task }` | The mark had a problem. The task is in line. |
| `{ kind: 'error', message }` | The mark was bad. |

## Not made yet

- The style finder in the extension. Read the section "The permission we do
  NOT have" above.

## The parts

| Entrypoint | Job |
|---|---|
| `entrypoints/background.ts` | The service worker. The WebSocket, the token, the routing. |
| `entrypoints/content.ts` | The content script. The overlay and the element read. |
| `entrypoints/bridge.content.ts` | The MAIN-world page bridge. The probe answer and the fiber read. |
| `entrypoints/sidepanel/` | The management panel. |
| `entrypoints/options/` | The companion address and the token. |
| `src/bus.ts` | The typed message bus and the probe protocol. |
| `src/config.ts` | The stored settings. |

## The commands

```bash
pnpm dev            # Chrome, with hot reload
pnpm dev:firefox    # Firefox, with hot reload
pnpm build          # Chrome, production
pnpm build:firefox  # Firefox, production
pnpm zip            # A zip for the Chrome Web Store
pnpm typecheck
```

## The load steps

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Press "Load unpacked".
5. Choose `packages/extension/.output/chrome-mv3`.
