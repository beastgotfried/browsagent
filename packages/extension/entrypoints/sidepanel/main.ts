import type { ElementRecord } from '@browsagent/shared';
import { browser } from 'wxt/browser';

import type { FromBackground, Selection, ToBackground } from '../../src/bus.js';

const state = document.getElementById('state');
const record = document.getElementById('record');

function paint(connected: boolean, server: string, queued: number): void {
  if (state === null) return;
  state.textContent = connected ? `connected (${queued} queued)` : 'offline';
  state.className = connected ? 'pill pill--on' : 'pill pill--off';
  state.title = server;
}

/**
 * Show the record that the content script read.
 *
 * This answer is immediate. It comes from the page and needs no companion.
 */
function show(selection: Selection): void {
  if (record === null) return;
  record.textContent = JSON.stringify(
    {
      from: 'the page',
      source: `${selection.stamp.src.file}:${selection.stamp.src.line}`,
      component: selection.stamp.component,
      expressions: selection.stamp.expressions,
      values: selection.record.values,
      editable: selection.stamp.editable,
      viewport: selection.record.viewport,
    },
    null,
    2,
  );
}

/**
 * Show the record that the companion sent back.
 *
 * The companion joins the static side and the live side. It adds the style
 * rules and the use sites. The confidence value tells the user how much the
 * tool trusts the source position.
 */
function showRecord(full: ElementRecord): void {
  if (record === null) return;
  record.textContent = JSON.stringify(
    {
      from: 'the companion',
      source: `${full.src.file}:${full.src.line}:${full.src.column}`,
      component: full.component,
      confidence: full.confidence,
      editable: full.editable,
      styleRules: full.styles.length,
      useSites: full.useSites.map((site) => `${site.file}:${site.line}`),
    },
    null,
    2,
  );
}

function showError(message: string): void {
  if (state === null) return;
  state.textContent = `error: ${message}`;
  state.className = 'pill pill--off';
  state.title = '';
}

function ask(): void {
  void browser.runtime
    .sendMessage({ kind: 'status' } satisfies ToBackground)
    .then((answer: unknown) => {
      const typed = answer as FromBackground | undefined;
      if (typed?.kind === 'status') paint(typed.connected, typed.server, typed.queued);
    })
    .catch(() => undefined);
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const typed = message as FromBackground;
  if (typed.kind === 'status') paint(typed.connected, typed.server, typed.queued);
  if (typed.kind === 'selected') show(typed.selection);
  if (typed.kind === 'record') showRecord(typed.record);
  if (typed.kind === 'error') showError(typed.message);
});

ask();
