#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import {
  acceptDiff,
  AgentRunner,
  faultWords,
  ModelAgent,
  worktreeDiff,
  type RunnerOptions,
} from '@browsagent/agent-runner';
import { isStale, makeContext, readContext, writeContext } from '@browsagent/context';
import { IndexService } from '@browsagent/index-service';
import {
  hasKey,
  loadProviderConfig,
  loadToken,
  ModelClient,
  ProviderError,
  type ProviderErrorCode,
} from '@browsagent/model';
import {
  DEFAULT_PORT,
  type AcceptResult,
  type ProjectContext,
  type ProviderState,
  type Task,
} from '@browsagent/shared';

/**
 * The check command of this project.
 *
 * The type check is a required gate. The build runs first: a fresh worktree
 * holds no build output, and a workspace package without its dist has no
 * types for its importers.
 */
const TYPECHECK = 'pnpm -r build && pnpm -r typecheck';

/**
 * The prepare command of this project. The type check runs in a fresh
 * worktree. That worktree holds no node_modules, so the dependencies must
 * come first. The store of pnpm usually holds every package already.
 */
const PREPARE = 'pnpm install --frozen-lockfile --prefer-offline';

/** The manager stops one task after this many tries. */
const MAX_TRIES = 3;

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * One line for the provider state. The line names the base and the model.
 * The line never holds the key.
 */
function providerLine(state: ProviderState): string {
  if (state.status === 'no-key') return 'no key. Repairs are off.';
  if (state.status === 'key-bad') {
    return `key bad. ${state.fault ?? 'The provider refused the key.'}`;
  }
  return `key set. base ${state.apiBase}, model ${state.model}`;
}

/** One line for the context state. A stale context does not block a repair. */
function contextLine(context: ProjectContext | null, stale: boolean, commit: string): string {
  if (context === null) return 'missing. Press Make again in the panel to make it.';
  if (stale) return `stale. Made at ${context.commit}. HEAD is ${commit}.`;
  return `fresh. Made at ${context.commit}.`;
}

async function start(): Promise<void> {
  const root = process.cwd();
  const port = Number(process.env['BROWSAGENT_PORT'] ?? DEFAULT_PORT);
  const project = process.env['BROWSAGENT_PROJECT'] ?? root.split('/').pop() ?? 'project';

  const config = await loadProviderConfig(root);
  const client = new ModelClient(config);

  // The extension makes the token. The companion must hold the same value.
  // Without a token any page or process on this machine can use the service.
  const token = await loadToken(root);
  if (token === null) {
    console.error('[browsagent] No token is set. The companion does not start.');
    console.error('[browsagent] Copy the token from the extension options page.');
    console.error('[browsagent] Then set BROWSAGENT_TOKEN, or add a "token" value to .browsagent/config.json.');
    process.exitCode = 1;
    return;
  }

  // The agent gets this context. A later context pass replaces this binding.
  let context: ProjectContext | null = await readContext(root);

  // The provider report for the panel. The state type holds no key field.
  let providerFault: string | null = null;
  let keyRefused = false;

  /**
   * Keep the words of one fault for the panel.
   *
   * The value can be a ProviderError, the fault string of a task with its
   * provider code, or a plain fault. A plain fault carries no code: only the
   * words of a task fault survive the runner.
   */
  const noteFault = (fault: unknown, code: ProviderErrorCode | null = null): void => {
    if (fault instanceof ProviderError) {
      providerFault = fault.message;
      // The 401 code is 'key-refused'. The code 'no-key' means that no key is
      // set, and hasKey already reports that case.
      if (fault.code === 'key-refused') keyRefused = true;
      return;
    }
    if (typeof fault === 'string' && fault.trim() !== '') {
      providerFault = fault;
      // A task fault carries the code of the provider. Only a refused key
      // moves the panel to the key bad state.
      if (code === 'key-refused') keyRefused = true;
    }
  };

  const providerState = (): ProviderState => ({
    status: hasKey(config) ? (keyRefused ? 'key-bad' : 'key-set') : 'no-key',
    apiBase: config.apiBase,
    model: config.model,
    modelCheap: config.modelCheap,
    fault: providerFault,
  });

  const contextState = (): { context: ProjectContext | null; stale: boolean } => ({
    context,
    // HEAD can move while the companion runs. Read it for each answer.
    stale: context !== null && isStale(context, currentCommit()),
  });

  const worktreeDir = `${root}/.browsagent/worktrees`;
  const runnerOptions: RunnerOptions = {
    root,
    worktreeDir,
    // The check runs in a fresh worktree. The prepare command gives that
    // worktree its dependencies before the agent starts.
    prepare: PREPARE,
    typecheck: TYPECHECK,
    // This project has no lint. An empty command means "no lint". The runner
    // then reports lintOk null. It never reports a pass.
    lint: '',
    maxTries: MAX_TRIES,
  };
  let runner = new AgentRunner(runnerOptions, new ModelAgent(client, context));

  /**
   * Repair one task.
   *
   * The runner makes the worktree, asks for the plan, makes the edit, and
   * runs the check. This function writes the result into the task and
   * returns it. The service stores the task and sends it to the panel.
   */
  const onTask = async (task: Task): Promise<Task> => {
    try {
      const result = await runner.run(task);
      // The runner keeps the words and the provider code of a task fault in
      // the evidence. Give both to the panel: a refused key moves the
      // provider state to "key bad", and any other provider fault shows its
      // words.
      noteFault(result.evidence.fault, result.evidence.faultCode);
      const cwd = `${worktreeDir}/${task.id.slice(0, 8)}`;
      // The runner measures the diff now. Measure it here a second time. The
      // two measurements must agree. A difference means one of them is wrong,
      // and the diff is the only evidence that the repair is correct.
      const measured = await worktreeDiff(cwd);
      if (result.diff !== measured) {
        await runner.removeWorktree(task).catch(() => undefined);
        return {
          ...task,
          state: 'failed',
          plan: result.plan.text,
          files: result.plan.files,
          diff: result.diff,
          evidence: { ...result.evidence, diff: result.diff },
          updatedAt: new Date().toISOString(),
        };
      }
      const next: Task = {
        ...task,
        state: result.state,
        plan: result.plan.text,
        files: result.plan.files,
        diff: measured,
        evidence: { ...result.evidence, diff: measured },
        updatedAt: new Date().toISOString(),
      };
      // A done task keeps its worktree: the accept step needs the diff. A
      // failed or unchecked task has no later use. Remove its worktree.
      if (next.state !== 'done') await runner.removeWorktree(task).catch(() => undefined);
      return next;
    } catch (error) {
      const fault = faultWords(error);
      // A ProviderError keeps its code. A plain fault keeps only its words.
      noteFault(error instanceof ProviderError ? error : fault);
      // Return the task in the failed state. A throw here leaves the task in
      // the queued state for ever, and the panel then shows a task that never
      // moves. The worktree of a failed task goes away, because the accept
      // step does not need it.
      await runner.removeWorktree(task).catch(() => undefined);
      return {
        ...task,
        state: 'failed',
        diff: '',
        // No gate ran on this path. The evidence reports null: it never
        // claims that a check failed.
        evidence: {
          typecheckOk: null,
          lintOk: null,
          diff: '',
          tries: task.tries,
          fault,
          // A provider fault keeps its code on this path too, so the evidence
          // names the class of the fault.
          faultCode: error instanceof ProviderError ? error.code : null,
        },
        updatedAt: new Date().toISOString(),
      };
    }
  };

  /**
   * Make one context pass. Write the document and the record.
   *
   * The agent reads the context at the start of each call. Rebuild the agent
   * after the pass, so a later repair uses the new context.
   */
  const onContext = async (): Promise<ProjectContext | null> => {
    try {
      // Read HEAD at the time of the pass. The commit of the process start can
      // be old, and the panel would then report a stale context as fresh.
      const made = await makeContext(root, client, currentCommit(), config.modelCheap);
      await writeContext(root, made);
      context = made;
      runner = new AgentRunner(runnerOptions, new ModelAgent(client, context));
      return made;
    } catch (error) {
      noteFault(error);
      throw error;
    }
  };

  /**
   * Apply the patch of one accepted task.
   *
   * D9: the tool applies the patch to the working tree with git apply. It
   * makes no commit and no branch. The worktree goes away after the apply.
   */
  const onAccept = async (task: Task): Promise<AcceptResult> => {
    // The task holds the measured diff. The worktree of a failed task is gone,
    // so the stored measurement is the only copy of the repair.
    const result = await acceptDiff(root, task.diff ?? '');
    // A refused accept keeps the worktree. The user can try again after the
    // working tree moves. A refusal must not destroy the only copy.
    if (result.applied) await runner.removeWorktree(task);
    return result;
  };

  const service = new IndexService({
    port,
    project,
    commit: currentCommit,
    token,
    onTask,
    onContext,
    onAccept,
    contextState,
    providerState,
  });

  console.info(`[browsagent] provider: ${providerLine(providerState())}`);
  console.info(
    `[browsagent] context: ${contextLine(context, contextState().stale, currentCommit())}`,
  );

  const bound = await service.listen();
  console.info(`[browsagent] index service on port ${bound}`);
  console.info(`[browsagent] project ${project}`);
  console.info('[browsagent] add @browsagent/vite-plugin to the project config');
}

void start().catch((error: unknown) => {
  // A busy port and a bad address are setup faults. Report the words.
  const words = error instanceof Error ? error.message : String(error);
  console.error(`[browsagent] The companion did not start. ${words}`);
  process.exitCode = 1;
});
