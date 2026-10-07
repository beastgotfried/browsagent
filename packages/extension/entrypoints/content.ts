import { Overlay, readRecord, readStamp } from '@browsagent/client';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';

import type { FromBackground, Selection, ToBackground } from '../src/bus.js';

/**
 * The content script.
 *
 * Its jobs:
 * 1. Draw the element-selection overlay.
 * 2. Read the stamp and the live value of the selected element.
 * 3. Send the selection to the background worker.
 */
export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_idle',

  main() {
    let overlay: Overlay | null = null;

    const send = (message: ToBackground): void => {
      void browser.runtime.sendMessage(message).catch(() => undefined);
    };

    const stop = (): void => {
      overlay?.stop();
      overlay = null;
    };

    const start = (): void => {
      // The overlay stops itself when the user presses Escape. Call start
      // again. A second start and a second stop are both safe.
      if (overlay !== null) {
        overlay.start();
        return;
      }
      overlay = new Overlay({
        onSelect: (node) => {
          stop();
          const stamp = readStamp(node);
          if (stamp === null) {
            // The element has no stamp. Example: a node from a third-party
            // script. Do not guess. Report it.
            void browser.runtime.sendMessage({
              kind: 'error',
              message: 'This element has no source stamp.',
            } satisfies ToBackground);
            return;
          }
          const selection: Selection = {
            stamp,
            record: readRecord(node),
            tabUrl: window.location.href,
          };
          send({ kind: 'selected', selection });
        },
      });
      overlay.start();
    };

    browser.runtime.onMessage.addListener((message: unknown) => {
      const typed = message as FromBackground;
      if (typed.kind !== 'overlay') return;
      // The worker owns the overlay state. A true value starts the overlay and
      // a false value stops it. This script does not toggle the overlay.
      if (typed.active) start();
      else stop();
    });
  },
});
