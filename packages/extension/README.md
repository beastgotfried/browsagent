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
| `scripting` | Add the content script. |
| `storage` | Keep the server address and the token. |
| `sidePanel` | WXT adds this because the `sidepanel` entrypoint exists. |

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

## The parts

| Entrypoint | Job |
|---|---|
| `entrypoints/background.ts` | The service worker. The WebSocket, the token, the routing. |
| `entrypoints/content.ts` | The content script. The overlay and the element read. |
| `entrypoints/sidepanel/` | The management panel. |
| `entrypoints/options/` | The companion address and the token. |
| `src/bus.ts` | The typed message bus. |
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
