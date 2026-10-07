#!/usr/bin/env node
/**
 * prove-e2e.mjs — prove the whole path with one command and no browser.
 *
 * The script does eight steps:
 * 1. Start the companion as a child process. Wait for the port.
 * 2. Open one websocket to the companion.
 * 3. Send one hello message. Wait for the answer.
 * 4. Send one mark. The mark holds a real problem and a real selection.
 * 5. Wait for the task. Print the state and the diff.
 * 6. Send one accept message when the diff is not empty.
 * 7. Print PASS or FAIL for each step.
 * 8. Stop the child process on every path. Exit with the right code.
 *
 * The script uses the node builtins and the `ws` package that the
 * index-service already installs. The root package does not depend on `ws`,
 * so the script resolves the package from the index-service directory. The
 * script adds no dependency.
 *
 * The script never reads the API key. Every printed line passes the
 * redaction function first.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const companionEntry = resolve(root, 'packages/cli/dist/index.js');
const serviceRequire = createRequire(resolve(root, 'packages/index-service/package.json'));
const { WebSocket } = serviceRequire('ws');

const HOST = '127.0.0.1';
const PORT = 4517;
// The companion refuses a caller without the shared token. The script holds
// the same value in the environment of the child process.
const TOKEN = 'proof-token';
const STATE_URL = `http://${HOST}:${PORT}/state?token=${TOKEN}`;
const SOCKET_URL = `ws://${HOST}:${PORT}/mark?token=${TOKEN}`;

const PORT_TIMEOUT_MS = 30_000;
const SOCKET_TIMEOUT_MS = 10_000;
const TASK_TIMEOUT_MS = 60_000;
const REPAIR_TIMEOUT_MS = 600_000;
const ACCEPT_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 10_000;
const DIFF_LIMIT = 4000;

/**
 * The real element. The source position names the card article in the demo
 * page. The plugin makes these values in a development build. The instance
 * identity joins the static stamp and the live record.
 */
const MARK_SELECTION = {
  stamp: {
    src: { file: 'examples/demo-app/src/App.tsx', line: 37, column: 7 },
    component: 'Card',
    expressions: {},
    editable: true,
    parentSrc: { file: 'examples/demo-app/src/App.tsx', line: 47, column: 5 },
    inst: 'i5',
  },
  record: {
    inst: 'i5',
    values: { className: 'card' },
    state: { hover: false, focus: false, active: false, open: false, disabled: false },
    viewport: { name: 'current', width: 1280, height: 800 },
  },
  tabUrl: 'http://localhost:4519/',
};

/** The real problem. The user points at the card and writes these words. */
const MARK_PROBLEM = {
  type: 'spacing',
  severity: 'medium',
  text: 'The space between the card border and the card content is too small.',
  expected: 'About 24 pixels of padding inside the card.',
  propagate: 'auto',
  viewports: [{ name: 'current', width: 1280, height: 800 }],
};

const TITLES = [
  'companion starts',
  'websocket opens',
  'hello answered',
  'mark with a real problem',
  'task arrives',
  'the repair diff arrives',
  'accept applies the patch',
  'companion stops',
];

let child = null;
let exitInfo = null;
let exitPromise = Promise.resolve(false);
let socket = null;
let task = null;
let accepted = null;
let childPending = '';
const childTail = [];
const inbox = [];
const waiters = [];

/** One line for one step. Every line passes the redaction function first. */
function report(number, title, state, detail = '') {
  const head = `step ${number}  ${title} `.padEnd(44, '.');
  const tail = detail === '' ? '' : `  ${detail}`;
  console.log(redacted(`${head} ${state}${tail}`));
}

function words(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Remove a key from one text. A provider or a proxy can echo a key. */
function redacted(text) {
  return String(text)
    .replace(/Bearer\s+\S+/gi, 'Bearer <removed>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-<removed>');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Read GET /state. Return null when the companion does not answer. */
async function readState() {
  try {
    const response = await fetch(STATE_URL);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function contextWords(state) {
  if (state === null || state === undefined || state.context === null) return 'context missing';
  return state.stale === true ? 'context stale' : 'context fresh';
}

/** The provider fault, in the words of the provider. Empty when there is none. */
async function providerWords() {
  const state = await readState();
  const provider = state?.provider ?? null;
  if (provider === null) return '';
  if (typeof provider.fault === 'string' && provider.fault !== '') {
    return ` The provider said: ${provider.fault}`;
  }
  if (provider.status !== 'key-set') return ` The provider state is "${provider.status}".`;
  return '';
}

/** The words of a task that stopped without a diff. */
function taskFailWords() {
  const bits = [];
  const evidence = task?.evidence ?? null;
  if (evidence !== null) {
    const typecheck = evidence.typecheckOk === null ? 'did not run' : String(evidence.typecheckOk);
    bits.push(`typecheckOk ${typecheck}`);
  }
  if (typeof task?.plan === 'string' && task.plan !== '') {
    bits.push(`the plan: ${task.plan.slice(0, 160)}`);
  }
  return bits.length === 0 ? '' : ` The task holds: ${bits.join('; ')}.`;
}

function diffWords(diff) {
  if (diff === null || diff === undefined) return 'diff null';
  if (typeof diff !== 'string') return `diff ${String(diff)}`;
  if (diff.trim() === '') return 'diff empty';
  return `diff ${diff.split('\n').filter((line) => line !== '').length} lines`;
}

/** The file names in the patch headers. This reads the same lines as git. */
function diffFiles(diff) {
  const names = new Set();
  if (typeof diff !== 'string') return [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- a/')) names.add(line.slice('--- a/'.length));
    else if (line.startsWith('+++ b/')) names.add(line.slice('+++ b/'.length));
  }
  return [...names];
}

function printDiff(diff) {
  if (typeof diff !== 'string' || diff.trim() === '') return;
  const text =
    diff.length > DIFF_LIMIT
      ? `${diff.slice(0, DIFF_LIMIT)}\n... (${diff.length - DIFF_LIMIT} more characters)`
      : diff;
  for (const line of text.split('\n')) console.log(redacted(`  ${line}`));
}

/** Print the check result and the state, so a failed check is visible. */
function printTaskInfo() {
  const evidence = task?.evidence ?? null;
  if (evidence !== null) {
    const typecheck = evidence.typecheckOk === null ? 'did not run' : String(evidence.typecheckOk);
    const lint = evidence.lintOk === null ? 'did not run' : String(evidence.lintOk);
    console.log(redacted(`  evidence: typecheckOk ${typecheck}, lintOk ${lint}`));
  }
  if (task?.state !== 'done') {
    console.log(
      redacted(
        `  info: the task state is "${task?.state}". The script still accepts, because the diff is not empty.`,
      ),
    );
  }
}

function startCompanion() {
  child = spawn(process.execPath, [companionEntry], {
    cwd: root,
    env: {
      ...process.env,
      BROWSAGENT_PORT: String(PORT),
      BROWSAGENT_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exitPromise = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal, error: null };
      resolveExit(true);
    });
    child.once('error', (error) => {
      exitInfo = { code: null, signal: null, error: words(error) };
      resolveExit(true);
    });
  });
  child.stdout.on('data', onChildData);
  child.stderr.on('data', onChildData);
}

function onChildData(chunk) {
  childPending += chunk.toString();
  const parts = childPending.split('\n');
  childPending = parts.pop() ?? '';
  for (const line of parts) {
    const text = line.trimEnd();
    if (text === '') continue;
    childTail.push(text);
    if (childTail.length > 6) childTail.shift();
    console.log(redacted(`[companion] ${text}`));
  }
}

function exitWords() {
  if (exitInfo === null) return 'The companion is still running.';
  if (exitInfo.error !== null) return `The spawn failed: ${exitInfo.error}`;
  const code = exitInfo.code === null ? 'none' : String(exitInfo.code);
  const signal = exitInfo.signal === null ? 'none' : exitInfo.signal;
  const tail = childTail.length === 0 ? '' : ` Last words: ${childTail.slice(-3).join(' | ')}`;
  return `Exit code ${code}, signal ${signal}.${tail}`;
}

async function waitForPort() {
  const limit = Date.now() + PORT_TIMEOUT_MS;
  while (Date.now() < limit) {
    if (exitInfo !== null) {
      throw new Error(`The companion stopped before the port was ready. ${exitWords()}`);
    }
    const state = await readState();
    if (state !== null) {
      // A foreign process on the port kills the child with EADDRINUSE.
      await sleep(300);
      if (exitInfo !== null) {
        throw new Error(`The port ${PORT} is held by another process. ${exitWords()}`);
      }
      return state;
    }
    await sleep(250);
  }
  throw new Error(`The port ${PORT} gave no answer in ${PORT_TIMEOUT_MS / 1000} seconds.`);
}

function openSocket() {
  return new Promise((resolveOpen, rejectOpen) => {
    socket = new WebSocket(SOCKET_URL);
    socket.on('message', (data) => onSocketMessage(String(data)));
    socket.on('close', () => {
      for (const waiter of waiters.splice(0)) {
        waiter.giveError(new Error('The companion closed the websocket.'));
      }
    });
    const timer = setTimeout(() => {
      rejectOpen(new Error(`The websocket did not open in ${SOCKET_TIMEOUT_MS / 1000} seconds.`));
    }, SOCKET_TIMEOUT_MS);
    socket.on('open', () => {
      clearTimeout(timer);
      resolveOpen();
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      rejectOpen(
        new Error(`The websocket failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  });
}

function onSocketMessage(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    message = { kind: 'bad-json', text };
  }
  for (let at = 0; at < waiters.length; at += 1) {
    const waiter = waiters[at];
    if (waiter.match(message)) {
      waiters.splice(at, 1);
      waiter.give(message);
      return;
    }
  }
  inbox.push(message);
}

/** Wait for one message. Return it. Reject when the time runs out. */
function waitForMessage(match, timeoutMs, what) {
  const found = inbox.findIndex(match);
  if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0]);

  return new Promise((resolveMessage, rejectMessage) => {
    const waiter = {
      match,
      give: null,
      giveError: null,
    };
    const timer = setTimeout(() => {
      const at = waiters.indexOf(waiter);
      if (at >= 0) waiters.splice(at, 1);
      rejectMessage(new Error(`No ${what} arrived in ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);
    waiter.give = (message) => {
      clearTimeout(timer);
      resolveMessage(message);
    };
    waiter.giveError = (error) => {
      clearTimeout(timer);
      rejectMessage(error);
    };
    waiters.push(waiter);
  });
}

function send(message) {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    throw new Error('The websocket is not open.');
  }
  socket.send(JSON.stringify(message));
}

/** Wait until the task carries a diff, or until the task stops. */
async function waitForRepair() {
  const limit = Date.now() + REPAIR_TIMEOUT_MS;
  while (true) {
    if (typeof task.diff === 'string' && task.diff.trim() !== '') return;

    if (task.state === 'failed' || task.state === 'rejected') {
      throw new Error(
        `The task ended in the "${task.state}" state with no diff.${await providerWords()}${taskFailWords()}`,
      );
    }

    const left = limit - Date.now();
    if (left <= 0) {
      throw new Error(
        `No repair diff arrived in ${REPAIR_TIMEOUT_MS / 1000} seconds. ` +
          `The last state is "${task.state}".${await providerWords()}${taskFailWords()}`,
      );
    }

    const next = await waitForMessage(
      (message) =>
        (message.kind === 'task' && message.task.id === task.id) || message.kind === 'error',
      left,
      'the repaired task',
    );
    if (next.kind === 'error') throw new Error(`The companion reported a fault. ${next.message}`);
    task = next.task;
  }
}

async function stopCompanion() {
  if (socket !== null) {
    const closing = socket;
    socket = null;
    try {
      if (closing.readyState === WebSocket.OPEN) closing.close();
      closing.terminate();
    } catch {
      // The socket is already gone. Nothing to stop.
    }
  }

  if (child === null) return { ok: true, detail: 'the companion did not start' };
  if (exitInfo !== null) return { ok: true, detail: exitWords() };

  child.kill('SIGTERM');
  const stopped = await Promise.race([exitPromise, sleep(STOP_TIMEOUT_MS).then(() => false)]);
  if (stopped === false) {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, sleep(2_000)]);
  }
  if (exitInfo === null) return { ok: false, detail: 'the companion did not stop' };
  return { ok: true, detail: exitWords() };
}

const steps = [
  {
    title: TITLES[0],
    run: async () => {
      if (!existsSync(companionEntry)) {
        throw new Error(
          `The companion is absent at ${companionEntry}. Run "pnpm -r build" first.`,
        );
      }
      startCompanion();
      const state = await waitForPort();
      const provider = state.provider ?? null;
      const parts = [
        `port ${PORT}`,
        `provider ${provider?.status ?? 'unknown'}`,
        contextWords(state.context),
      ];
      if (provider?.status === 'no-key' || provider?.status === 'key-bad') {
        parts.push('the repair will fail');
      }
      return parts.join(', ');
    },
  },
  {
    title: TITLES[1],
    run: async () => {
      await openSocket();
      const welcome = await waitForMessage(
        (message) => message.kind === 'indexed' || message.kind === 'error',
        SOCKET_TIMEOUT_MS,
        'the connection answer',
      );
      if (welcome.kind === 'error') {
        throw new Error(`The companion refused the socket. ${welcome.message}`);
      }
      return `ws://${HOST}:${PORT}/mark, indexed count ${welcome.count}`;
    },
  },
  {
    title: TITLES[2],
    run: async () => {
      send({ kind: 'hello', project: 'demo', route: '/' });
      const answer = await waitForMessage(
        (message) => message.kind === 'indexed' || message.kind === 'error',
        SOCKET_TIMEOUT_MS,
        'the hello answer',
      );
      if (answer.kind === 'error') {
        throw new Error(`The companion refused the hello. ${answer.message}`);
      }
      return `indexed count ${answer.count}`;
    },
  },
  {
    title: TITLES[3],
    run: async () => {
      send({ kind: 'mark', selection: MARK_SELECTION, problem: MARK_PROBLEM });
      return `${MARK_SELECTION.stamp.src.file}:${MARK_SELECTION.stamp.src.line}`;
    },
  },
  {
    title: TITLES[4],
    run: async () => {
      const first = await waitForMessage(
        (message) => message.kind === 'task' || message.kind === 'error',
        TASK_TIMEOUT_MS,
        'the task',
      );
      if (first.kind === 'error') throw new Error(`The companion made no task. ${first.message}`);
      task = first.task;
      return `id ${task.id.slice(0, 8)}, state ${task.state}, ${diffWords(task.diff)}`;
    },
  },
  {
    title: TITLES[5],
    run: async () => {
      await waitForRepair();
      const files = diffFiles(task.diff);
      return `state ${task.state}, ${diffWords(task.diff)}, ${
        files.length === 0 ? 'no file header' : files.join(', ')
      }`;
    },
    after: () => {
      console.log('');
      printDiff(task.diff);
      console.log('');
      printTaskInfo();
    },
  },
  {
    title: TITLES[6],
    run: async () => {
      send({ kind: 'accept', taskId: task.id });
      const answer = await waitForMessage(
        (message) => message.kind === 'accepted' || message.kind === 'error',
        ACCEPT_TIMEOUT_MS,
        'the accept answer',
      );
      if (answer.kind === 'error') {
        throw new Error(`The tool refused the accept. ${answer.message}`);
      }
      if (answer.result.applied !== true) {
        throw new Error(`The tool did not apply the patch. ${answer.result.message}`);
      }
      accepted = answer.result;
      return `applied, files ${accepted.files.length === 0 ? 'absent' : accepted.files.join(', ')}`;
    },
    after: () => {
      console.log(redacted(`  ${accepted.message}`));
      if (accepted.files.length > 0) {
        console.log(redacted(`  the files: ${accepted.files.join(', ')}`));
      }
    },
  },
];

async function main() {
  console.log('browsagent end-to-end proof. No browser is needed.');
  console.log('');

  let failure = null;
  for (let at = 0; at < steps.length; at += 1) {
    const step = steps[at];
    if (failure !== null) {
      report(at + 1, step.title, 'SKIP', 'an earlier step failed');
      continue;
    }
    try {
      const detail = await step.run();
      report(at + 1, step.title, 'PASS', detail);
      if (step.after !== undefined) step.after();
    } catch (error) {
      failure = error;
      report(at + 1, step.title, 'FAIL', words(error));
    }
  }

  const stopped = await stopCompanion();
  const stopNumber = TITLES.length;
  report(stopNumber, TITLES[stopNumber - 1], stopped.ok ? 'PASS' : 'FAIL', stopped.detail);
  if (!stopped.ok && failure === null) failure = new Error(stopped.detail);

  console.log('');
  if (failure === null) {
    console.log('PROOF PASSED. The path works from the mark to the applied patch.');
  } else {
    console.log(redacted(`PROOF FAILED: ${words(failure)}`));
  }
  process.exitCode = failure === null ? 0 : 1;
}

process.on('exit', () => {
  if (child !== null && exitInfo === null) child.kill('SIGKILL');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child !== null && exitInfo === null) child.kill('SIGKILL');
    process.exit(130);
  });
}

void main();
