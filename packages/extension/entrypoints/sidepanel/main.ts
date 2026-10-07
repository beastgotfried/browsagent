import {
  PROBLEM_TYPES,
  type AcceptResult,
  type ElementRecord,
  type Problem,
  type ProblemType,
  type Task,
} from '@browsagent/shared';
import { browser } from 'wxt/browser';

import type { FromBackground, Selection, ToBackground } from '../../src/bus.js';

const state = document.getElementById('state');
const record = document.getElementById('record');
const form = document.getElementById('problem-form');
const typeSelect = document.getElementById('problem-type');
const textArea = document.getElementById('problem-text');
const sendButton = document.getElementById('problem-send');
const answer = document.getElementById('answer');
const taskList = document.getElementById('task-list');
const acceptAnswer = document.getElementById('accept-answer');

/** The last selection. The form sends this value with the problem. */
let lastSelection: Selection | null = null;

/** The tasks of the companion. The list read and the task messages fill it. */
let tasks: Task[] = [];

/** The identities of the applied tasks. The accept button of one card goes dark. */
const applied = new Set<string>();

function paint(connected: boolean, server: string, queued: number): void {
  if (state === null) return;
  state.textContent = connected ? `connected (${queued} queued)` : 'offline';
  state.className = connected ? 'pill pill--on' : 'pill pill--off';
  state.title = server;
}

/** Fill the select from the shared list. The list lives in one place. */
function fillTypes(): void {
  if (!(typeSelect instanceof HTMLSelectElement)) return;
  for (const type of PROBLEM_TYPES) typeSelect.append(new Option(type, type));
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

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function showJson(from: string, body: unknown): void {
  if (record === null) return;
  record.textContent = JSON.stringify({ from, body }, null, 2);
}

/** Show the selection from the page. This answer needs no companion. */
function show(selection: Selection): void {
  lastSelection = selection;
  updateButton();
  showJson('the page', selection);
}

/** Show the full record. The companion joins the stamp and the live record. */
function showRecord(full: ElementRecord): void {
  showJson('the companion', full);
}

function showError(message: string): void {
  if (state === null) return;
  state.textContent = `error: ${message}`;
  state.className = 'pill pill--off';
  state.title = '';
}

/** Send the mark with the problem. The worker holds the socket. */
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

/** Ask the worker to apply the patch of one task. */
function acceptTask(taskId: string): void {
  if (acceptAnswer !== null) acceptAnswer.textContent = 'The tool applies the patch...';
  void browser.runtime
    .sendMessage({ kind: 'accept', taskId } satisfies ToBackground)
    .catch(() => undefined);
}

/** Put one task in the array. The changed task goes at the start. */
function putTask(task: Task): void {
  tasks = [task, ...tasks.filter((item) => item.id !== task.id)];
  render();
}

/** Show the answer of the accept step. The applied task keeps a dark button. */
function showAccepted(result: AcceptResult, task: Task): void {
  if (result.applied) applied.add(task.id);
  putTask(task);
  if (acceptAnswer !== null) acceptAnswer.textContent = result.message;
}

/** Make one card: the source, the problem, the state, the diff, and the button. */
function card(task: Task): HTMLLIElement {
  const item = document.createElement('li');

  const label = el('span', task.state);
  label.className = 'pill';
  const head = el('p', `${task.record.src.file}:${task.record.src.line}`);
  head.prepend(label);
  item.append(head);

  item.append(el('p', `${task.problem.type}: ${task.problem.text}`));

  const diffText = task.diff ?? '';
  if (diffText.trim() !== '') item.append(el('pre', diffText));

  const accept = el('button', 'Accept the repair');
  accept.type = 'button';
  // No diff or an applied task gives the button nothing to do.
  accept.disabled = diffText.trim() === '' || applied.has(task.id);
  accept.addEventListener('click', () => acceptTask(task.id));
  item.append(accept);

  return item;
}

function render(): void {
  if (taskList === null) return;
  taskList.replaceChildren(...tasks.map(card));
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
  if (typed.kind === 'task') putTask(typed.task);
  if (typed.kind === 'task-list') {
    tasks = typed.tasks;
    render();
  }
  if (typed.kind === 'accepted') showAccepted(typed.result, typed.task);
});

fillTypes();
if (form instanceof HTMLFormElement) form.addEventListener('submit', sendMark);
if (textArea instanceof HTMLTextAreaElement) textArea.addEventListener('input', updateButton);
updateButton();

ask();
