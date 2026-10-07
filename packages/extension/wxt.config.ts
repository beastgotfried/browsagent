import { defineConfig } from 'wxt';

/**
 * The manifest of the extension.
 *
 * WXT makes the manifest from this file and from the entrypoints. There is no
 * manifest.json in the source.
 *
 * The permission list is narrow on purpose:
 * - `activeTab`  read the current tab after a user action.
 * - `alarms`     wake the worker. The worker repairs a dead socket.
 * - `scripting`  add the content script.
 * - `storage`    keep the server address and the token.
 *
 * WXT adds `sidePanel` because the sidepanel entrypoint exists. WXT adds `tabs`
 * and `scripting` during development for hot reload.
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

    permissions: ['activeTab', 'alarms', 'scripting', 'storage'],

    // The development hosts only. Every other host uses activeTab.
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],

    action: {
      default_title: 'browsagent: toggle the element overlay',
    },

    commands: {
      'toggle-overlay': {
        suggested_key: {
          default: 'Ctrl+Shift+M',
          mac: 'Command+Shift+M',
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
              strict_min_version: '121.0',
            },
          }
        : undefined,
  }),
});
