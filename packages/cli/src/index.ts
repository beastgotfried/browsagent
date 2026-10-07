#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import {
  acceptDiff,
  AgentRunner,
  ModelAgent,
  worktreeDiff,
  type RunnerOptions,
} from '@browsagent/agent-runner';
import { isStale, makeContext, readContext, writeContext } from '@browsagent/context';
import { IndexService } from '@browsagent/index-service';
import { hasKey, loadProviderConfig, ModelClient, ProviderError } from '@browsagent/model';
import {
  DEFAULT_PORT,
  type AcceptResult,
  type ProjectContext,
  type ProviderState,
  type Task,
} from '@browsagent/shared';

/** The type check command of this project. The type check is a required gate. */
const TYPECHECK = 'pnpm -r typecheck';

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
  const commit = currentCommit();

  const config = await loadProviderConfig(root);
  const client = new ModelClient(config);

  // The agent gets this context. A later context pass replaces this binding.
  let context: ProjectContext | null = await readContext(root);

  // The provider report for the panel. The state type holds no key field.
  let providerFault: string | null = null;
  let keyRefused = false;

  /** Keep the words of one provider fault for the panel. */
  const noteFault = (error: unknown): void => {
    if (!(error instanceof ProviderError)) return;
    providerFault = error.message;
    if (error.code === 'no-key') keyRefused = true;
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
    stale: context !== null && isStale(context, commit),
  });

  const worktreeDir = `${root}/.browsagent/worktrees`;
  const runnerOptions: RunnerOptions = {
    root,
    worktreeDir,
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
      const cwd = `${worktreeDir}/${task.id.slice(0, 8)}`;
      // The runner measures the diff now. Measure it here a second time. The
      // two measurements must agree. A difference means one of them is wrong,
      // and the diff is the only evidence that the repair is correct.
      const measured = await worktreeDiff(cwd);
      if (result.diff !== measured) {
        noteFault('the runner diff and the measured diff are different');
      }
      return {
        ...task,
        state: result.state,
        plan: result.plan.text,
        files: result.plan.files,
        diff: measured,
        evidence: { ...result.evidence, diff: measured },
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      noteFault(error);
      // Return the task in the failed state. A throw here leaves the task in
      // the queued state for ever, and the panel then shows a task that never
      // moves. A failed task is never accepted, so its worktree goes away. A
      // done task keeps its worktree, because the accept step needs it.
      await runner.removeWorktree(task).catch(() => undefined);
      return {
        ...task,
        state: 'failed',
        diff: '',
        evidence: { typecheckOk: false, lintOk: null, diff: '' },
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
      const made = await makeContext(root, client, commit, config.modelCheap);
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
    const cwd = `${worktreeDir}/${task.id.slice(0, 8)}`;
    const diff = await worktreeDiff(cwd);
    const result = await acceptDiff(root, diff);
    await runner.removeWorktree(task);
    return result;
  };

  const service = new IndexService({
    port,
    project,
    commit,
    onTask,
    onContext,
    onAccept,
    contextState,
    providerState,
  });

  console.info(`[browsagent] provider: ${providerLine(providerState())}`);
  console.info(`[browsagent] context: ${contextLine(context, contextState().stale, commit)}`);

  const bound = await service.listen();
  console.info(`[browsagent] index service on port ${bound}`);
  console.info(`[browsagent] project ${project}`);
  console.info('[browsagent] add @browsagent/vite-plugin to the project config');
}

void start();
