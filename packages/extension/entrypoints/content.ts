import { Overlay, instanceId, readRecord, readStamp } from '@browsagent/client';
import type { StaticStamp } from '@browsagent/shared';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  createProbeToken,
  isProbeResult,
  PROBE_ATTR,
  PROBE_TIMEOUT_MS,
  type FromBackground,
  type ProbeRequest,
  type ProbeResult,
  type Selection,
  type ToBackground,
} from '../src/bus.js';

/**
 * The content script.
 *
 * Its jobs:
 * 1. Draw the element-selection overlay.
 * 2. Read the stamp and the live value of the selected element.
 * 3. Ask the MAIN-world page bridge for the React source when the element has
 *    no stamp.
 * 4. Send the selection to the background worker.
 */

/**
 * Ask the page bridge for the React source of one node.
 *
 * The attribute on the node carries the token. The bridge reads the token and
 * posts a result. The answer is the result, or null after PROBE_TIMEOUT_MS.
 */
function probe(node: Element): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const token = createProbeToken();
    const request: ProbeRequest = { source: 'browsagent', kind: 'probe', token };
    const finish = (result: ProbeResult | null): void => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      // Two probes of one node can overlap. Remove the attribute only when it
      // still carries the token of this probe.
      if (node.getAttribute(PROBE_ATTR) === token) {
        node.removeAttribute(PROBE_ATTR);
      }
      resolve(result);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (!isProbeResult(data)) return;
      if (data.token !== token) return;
      finish(data);
    };
    const timer = window.setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    node.setAttribute(PROBE_ATTR, token);
    window.postMessage(request, '*');
  });
}

/** Make a static stamp from one bridge result. Null if the result has no source. */
function stampFromProbe(node: Element, result: ProbeResult): StaticStamp | null {
  const src = result.src;
  if (src === null) return null;
  return {
    src,
    component: result.component,
    expressions: {},
    editable: !src.file.includes('node_modules'),
    parentSrc: null,
    inst: instanceId(node),
  };
}

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

    /**
     * Read the stamp of the node. Ask the bridge when the node has no stamp.
     * Report the node when the bridge finds no source either.
     */
    const select = async (node: Element): Promise<void> => {
      let stamp = readStamp(node);
      if (stamp === null) {
        const result = await probe(node);
        stamp = result === null ? null : stampFromProbe(node, result);
      }
      if (stamp === null) {
        // The element has no stamp and no React source. Example: a node from a
        // third-party script. Do not guess. Report it.
        send({ kind: 'error', message: 'This element has no source stamp.' });
        return;
      }
      const selection: Selection = {
        stamp,
        record: readRecord(node),
        tabUrl: window.location.href,
      };
      send({ kind: 'selected', selection });
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
          void select(node);
        },
      });
      overlay.start();
    };

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const typed = message as FromBackground;
      if (typed.kind === 'overlay-query') {
        // The live state lives in this script. The worker asks for it before
        // each change. Therefore the two sides cannot disagree.
        sendResponse({
          kind: 'overlay-state',
          active: overlay?.isActive ?? false,
        } satisfies ToBackground);
        return false;
      }
      if (typed.kind !== 'overlay') return;
      // The worker sends the next state. A true value starts the overlay and a
      // false value stops it. This script does not toggle the overlay.
      if (typed.active) start();
      else stop();
    });
  },
});
