import { PROBLEM_TYPES } from '@browsagent/shared';
import type { ElementRecord, Problem, ProblemType } from '@browsagent/shared';
import { browser } from 'wxt/browser';

import type { FromBackground, Selection, ToBackground } from '../../src/bus.js';

const state = document.getElementById('state');
const record = document.getElementById('record');
const form = document.getElementById('problem-form');
const typeSelect = document.getElementById('problem-type');
const textArea = document.getElementById('problem-text');
const sendButton = document.getElementById('problem-send');
const answer = document.getElementById('answer');

/** The last selection. The form sends this value with the problem. */
let lastSelection: Selection | null = null;

function paint(connected: boolean, server: string, queued: number): void {
  if (state === null) return;
  state.textContent = connected ? `connected (${queued} queued)` : 'offline';
  state.className = connected ? 'pill pill--on' : 'pill pill--off';
  state.title = server;
}

/** Fill the select from the shared list. The list lives in one place. */
function fillTypes(): void {
  if (!(typeSelect instanceof HTMLSelectElement)) return;
  for (const type of PROBLEM_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    typeSelect.append(option);
  }
  typeSelect.value = 'layout';
}

/** Enable the button only when a selection and a problem text exist. */
function updateButton(): void {
  if (!(sendButton instanceof HTMLButtonElement)) return;
  const text = textArea instanceof HTMLTextAreaElement ? textArea.value.trim() : '';
  sendButton.disabled = lastSelection === null || text === '';
}

function say(message: string): void {
  if (answer === null) return;
  answer.textContent = message;
}

/**
 * Show the record that the content script read.
 *
 * This answer is immediate. It comes from the page and needs no companion.
 */
function show(selection: Selection): void {
  lastSelection = selection;
  updateButton();
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

/**
 * Send the mark with the problem to the worker.
 *
 * The worker holds the socket to the companion. The panel holds the problem
 * text. Therefore the panel sends the whole mark.
 */
function sendMark(event: SubmitEvent): void {
  event.preventDefault();
  const selection = lastSelection;
  if (selection === null) return;
  if (!(typeSelect instanceof HTMLSelectElement)) return;
  if (!(textArea instanceof HTMLTextAreaElement)) return;
  const text = textArea.value.trim();
  if (text === '') return;

  const problem: Problem = {
    // The select holds the values of PROBLEM_TYPES. The DOM types them as text.
    type: typeSelect.value as ProblemType,
    severity: 'medium',
    text,
    expected: null,
    propagate: 'auto',
    viewports: [],
  };

  say('Sending the repair request...');
  void browser.runtime
    .sendMessage({ kind: 'send-mark', selection, problem } satisfies ToBackground)
    .then(() => say('The worker has the repair request.'))
    .catch(() => say('The worker did not answer.'));
}

function ask(): void {
  void browser.runtime
    .sendMessage({ kind: 'status' } satisfies ToBackground)
    .then((reply: unknown) => {
      const typed = reply as FromBackground | undefined;
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

fillTypes();
if (form instanceof HTMLFormElement) form.addEventListener('submit', sendMark);
if (textArea instanceof HTMLTextAreaElement) {
  textArea.addEventListener('input', updateButton);
}
updateButton();

ask();
