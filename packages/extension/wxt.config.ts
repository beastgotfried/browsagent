import { defineConfig } from 'wxt';

/**
 * The manifest of the extension.
 *
 * WXT makes the manifest from this file and from the entrypoints. There is no
 * manifest.json in the source.
 *
 * The permission list is narrow on purpose:
 * - `alarms`     wake the worker. The worker repairs a dead socket.
 * - `storage`    keep the server address and the token.
 *
 * WXT adds `sidePanel` because the sidepanel entrypoint exists. WXT adds `tabs`
 * and `scripting` during development for hot reload. The permissions
 * `activeTab` and `scripting` are absent. No code uses them yet. The step that
 * adds the content script on demand must add them.
 *
 * The permission `debugger` is NOT here. The style finder needs it. Add it as an
 * optional permission in the step that makes the style finder. Do not ask for it
 * at install time.
 */
export default defineConfig({
  // WXT defaults to MV2 for Firefox. Pin MV3 for both targets.
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: 'browsagent',
    description:
      'Point at an element on a page. Write the problem. Get a checked patch.',
    minimum_chrome_version: '116',

    permissions: ['alarms', 'storage'],

    // The development hosts only. The content script uses the same list.
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],

    action: {
      default_title: 'browsagent: toggle the element overlay',
    },

    commands: {
      'toggle-overlay': {
        // Cmd+Shift+M is the Chrome profile switcher on macOS. Do not use it.
        // Cmd+Shift+E is not a Chrome default. The user can change any bind at
        // chrome://extensions/shortcuts.
        suggested_key: {
          default: 'Ctrl+Shift+E',
          mac: 'Command+Shift+E',
        },
        description: 'Toggle the element-selection overlay',
      },
    },

    // Firefox uses the same keys in MV3. WXT maps them when a field differs.
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'browsagent@local',
              // The MAIN-world content script needs Firefox 128 or later.
              strict_min_version: '128.0',
            },
          }
        : undefined,
  }),
});
