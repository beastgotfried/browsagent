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
| `activeTab` | Read the current tab after a user action. |
| `alarms` | Wake the worker. The worker repairs a dead socket. |
| `scripting` | Add the content script. |
| `storage` | Keep the server address and the token. |
| `sidePanel` | WXT adds this because the `sidepanel` entrypoint exists. |

WXT adds `tabs` to the development manifest. The hot reload uses it. The
production manifest does not hold it.

The host list holds the development hosts only:

```
http://localhost/*
http://127.0.0.1/*
```

Every other host uses `activeTab`. Do not add `<all_urls>`.

## The permission we do NOT have

The `debugger` permission is absent. The style finder needs it. Add it as an
**optional** permission in the step that makes the style finder. Ask for it at
run time, not at install time.

Reason: the `debugger` permission is global. It lets the extension attach to
any tab and read the page. A per-site list in the browser UI does not stop it.
Therefore the user must turn it on with a clear action.

## The overlay message contract

The `overlay` message sets the state. The message is not a toggle.

The worker owns the overlay state of each tab. The worker keeps the tab ids in
a set. Therefore the message carries the next state, and not a direction:

```ts
{ kind: 'overlay', active: boolean }
```

The worker sends the message to one tab. A `true` value starts the overlay. A
`false` value stops the overlay. The content script obeys the value. The
content script never flips its own state.

The worker accepts a request for a change in one of two ways:

1. The `toggle-overlay` command. The suggested key is `Ctrl+Shift+M`
   (`Command+Shift+M` on macOS).
2. A `{ kind: 'toggle-overlay' }` message.

Only the command is wired in the interface. The side panel does not send the
message yet.

The worker flips the value in its set. Then the worker sends the `overlay`
message with the new value. The content script stops the overlay before it
reports a selection or an error. The worker then forgets the tab. Therefore
the next request starts the overlay again.

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

`flushQueue` sends the marks in order. The worker removes a mark after its
send call. A worker stop can send a mark again. It cannot drop a mark.

### The reconnect

The backoff starts at 1000 ms and doubles to a maximum of 15000 ms. A
successful open resets the backoff to 1000 ms. The timer is the only guard.
`scheduleReconnect` returns while the timer exists.

### The alarm

An MV3 worker sleeps. The alarm `browsagent-keepalive` wakes the worker every
minute. When the socket is not connected, the worker calls `open()` and
repairs it. Chrome before version 120 clamps a shorter period to one minute. A
period of one minute is correct on every supported version.

The panel asks for `{ kind: 'status' }`. The worker answers after the queue
load:

```ts
{ kind: 'status', connected: boolean, server: string, queued: number }
```

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
   the token matches and the source is `browsagent`. The type checks keep a
   page message out of the stamp.
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

## Not made yet

- The problem editor. The worker sends the selection to the companion as one
  message: `{ kind: 'mark', stamp, record, tabUrl }`. The problem text is
  absent.
- The style finder in the extension. Read the section "The permission we do
  NOT have" above.
- The task flow in the side panel. The panel shows the status and the last
  selection only.

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
