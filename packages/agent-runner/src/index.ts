import { spawn } from 'node:child_process';

import { ProviderError, type ProviderErrorCode } from '@browsagent/model';

import { worktreeDiff } from './accept.js';

import type { Evidence, Task, TaskState } from '@browsagent/shared';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the process started. False when the process did not start. */
  started: boolean;
}

/** Run one command. Return the code and the output. */
export function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    let started = true;
    let settled = false;

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, started });
    };

    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
    child.on('error', (error) => {
      // The process did not start. Example: the shell is absent.
      started = false;
      stderr += error.message;
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

/** The words of one command. The command writes a refusal to stderr. */
export function commandWords(result: CommandResult): string {
  const words = (result.stderr.trim() === '' ? result.stdout : result.stderr).trim();
  return words === '' ? 'The command gave no message.' : words;
}

/** The most characters of a gate fault that the evidence keeps. */
const MAX_GATE_WORDS = 500;

/** The reason of a task that made no change. */
const NO_CHANGE_FAULT = 'The task made no change. The diff is empty.';

/** The words of one fault value. The value can be an Error or a plain value. */
export function faultWords(error: unknown): string {
  const words = error instanceof Error ? error.message : String(error);
  // An empty message names no reason. A failed task with no reason helps
  // nobody. Give the fault words of its own.
  return words.trim() === '' ? 'The fault carries no message.' : words;
}

/** The words of one failed gate, capped at 500 characters. */
function gateFault(result: CommandResult): string {
  const words = commandWords(result);
  return words.length > MAX_GATE_WORDS ? words.slice(0, MAX_GATE_WORDS) : words;
}

export interface RunnerOptions {
  /** The root of the project. */
  root: string;
  /** The directory for the worktrees. */
  worktreeDir: string;
  /** The maximum number of tries for one task. */
  maxTries?: number;
  /** The command for the type check. The runner needs this command. */
  typecheck: string;
  /** The command for the lint. Optional: a project can have no lint. */
  lint?: string;
  /**
   * A command that prepares the worktree after its creation. Example: an
   * install command. A fresh worktree holds no dependencies. A failed prepare
   * stops the task. Optional.
   */
  prepare?: string;
}

export interface AgentPlan {
  /** The short plan of the agent. The user can read the plan. */
  text: string;
  /** The files that the agent will change. */
  files: string[];
}

/** The interface of one agent. The runtime is not fixed. */
export interface Agent {
  /**
   * Make a plan. The agent gets the task record only. The agent must not
   * search the repo.
   */
  plan(task: Task, cwd: string): Promise<AgentPlan>;
  /**
   * Make the change. Return a SUMMARY of the change.
   *
   * The text is NOT the diff. It is often null. The runner measures the diff
   * itself with `git diff`. Evidence is measured, never reported.
   *
   * THE PLAN GOES IN. The plan names the files. An agent without the plan
   * explores the whole repository and spends its turn budget before it writes
   * anything. A plan that the repair call cannot read is a wasted model call.
   */
  edit(task: Task, cwd: string, plan: AgentPlan): Promise<string>;
}

/** The result of the code check. */
interface CheckResult {
  /** True when the type check passed. */
  typecheckOk: boolean;
  /** True when the lint passed. Null when the lint did not run. */
  lintOk: boolean | null;
  /**
   * True when the type check started. The type check is the required gate, so
   * this flag carries the answer of the whole check.
   */
  typecheckRan: boolean;
  /** The words of the failed gate. Null when every gate that ran passed. */
  fault: string | null;
}

/** True when every gate that ran passed. */
function passed(check: CheckResult): boolean {
  return check.typecheckOk && check.lintOk !== false;
}

/**
 * True when a provider fault is transient and a try remains.
 *
 * The code 'provider' covers a network fault, a timeout, an HTTP 5xx, an
 * answer that is not JSON, and an answer with no choice. A dropped connection
 * and an HTTP 5xx are worth another attempt. The codes 'no-key',
 * 'key-refused', 'data-policy', and 'no-credit' are permanent: a retry spends
 * money for the same answer.
 */
function retryAllowed(error: unknown, tries: number, maxTries: number): error is ProviderError {
  return error instanceof ProviderError && error.code === 'provider' && tries < maxTries;
}

/** True when the check asks for another attempt and a try remains. */
function checkAllowsRetry(
  check: CheckResult,
  diff: string,
  tries: number,
  maxTries: number,
): boolean {
  return check.typecheckRan && (!passed(check) || diff.trim() === '') && tries < maxTries;
}

/**
 * Phase 3 of the pipeline.
 *
 * The runner does five steps for each task:
 * 1. Make one worktree. One worktree for each task gives true separation.
 * 2. Ask the agent for a plan. Send the plan to the panel.
 * 3. Ask the agent for the edit.
 * 4. Check the result: the type check and the lint.
 * 5. Return the plan, the diff, the evidence, and the state.
 *
 * The check is the type check and the lint. There is no picture check.
 * Read `docs/DESIGN.md` D5.
 */
export class AgentRunner {
  constructor(
    private readonly options: RunnerOptions,
    private readonly agent: Agent,
  ) {
    if (options.typecheck.trim() === '') {
      // The type check is required. A missing command is a setup fault.
      throw new Error('RunnerOptions.typecheck is empty. The runner cannot run the check.');
    }
  }

  /** Make one worktree for one task. */
  async makeWorktree(task: Task): Promise<string> {
    const dir = `${this.options.worktreeDir}/${task.id.slice(0, 8)}`;
    // The commit of the mark gives the tree that the user sees. HEAD is the
    // fallback for a task without a commit.
    const commit = task.commit === '' ? 'HEAD' : task.commit;
    const made = await run('git', ['worktree', 'add', dir, commit], this.options.root);
    if (!made.started || made.code !== 0) {
      // A missing worktree makes every later tool call fail. Report the fault
      // here, where the words of git are still at hand.
      throw new Error(`The tool cannot make the worktree for the task. ${commandWords(made)}`);
    }

    const prepare = this.options.prepare?.trim();
    if (prepare !== undefined && prepare !== '') {
      const ready = await run('sh', ['-c', prepare], dir);
      if (!ready.started || ready.code !== 0) {
        throw new Error(`The prepare command failed in the worktree. ${commandWords(ready)}`);
      }
    }
    return dir;
  }

  /** Remove the worktree of one task. */
  async removeWorktree(task: Task): Promise<void> {
    const dir = `${this.options.worktreeDir}/${task.id.slice(0, 8)}`;
    await run('git', ['worktree', 'remove', '--force', dir], this.options.root);
  }

  /** Check the code. Return the result of each gate. */
  async checkCode(cwd: string): Promise<CheckResult> {
    const typecheck = await run('sh', ['-c', this.options.typecheck], cwd);
    if (!typecheck.started) {
      // The required gate did not start. No other gate can help. Keep the
      // words of the fault, so the evidence names the reason.
      return { typecheckOk: false, lintOk: null, typecheckRan: false, fault: gateFault(typecheck) };
    }

    const lintCommand = this.options.lint?.trim();
    const lint =
      lintCommand === undefined || lintCommand === ''
        ? null
        : await run('sh', ['-c', lintCommand], cwd);

    const typecheckOk = typecheck.code === 0;
    // A lint that did not start did not run. The value is null.
    const lintOk = lint === null || !lint.started ? null : lint.code === 0;

    // The words of the first gate that failed. The type check comes first: a
    // broken tree needs its compiler words more than its lint words.
    let fault: string | null = null;
    if (!typecheckOk) fault = gateFault(typecheck);
    else if (lint !== null && lint.code !== 0) fault = gateFault(lint);

    return { typecheckOk, lintOk, typecheckRan: true, fault };
  }

  /**
   * Run one task.
   *
   * The runner asks for one plan. Then it asks for one edit for each try. It
   * checks the code after each edit. It tries again while the check fails and
   * the try count is under maxTries. A transient provider fault also gets one
   * more try while the count allows it. A permanent provider fault ends the
   * task now.
   *
   * The state tells the truth about the check:
   * - `done`: the agent made an edit, the diff is not empty, and every gate
   *   that ran passed.
   * - `failed`: a gate failed after maxTries, the diff stayed empty, or the
   *   agent threw a fault.
   * - `unchecked`: no gate ran.
   *
   * A fault that ends the task never reports `done`. The evidence holds the
   * words of the fault in `evidence.fault` and the provider code in
   * `evidence.faultCode`. A transient fault that a later try replaces leaves
   * no fault in the evidence, and the task can end `done`.
   */
  async run(
    task: Task,
  ): Promise<{ evidence: Evidence; diff: string; plan: AgentPlan; state: TaskState }> {
    const maxTries = this.options.maxTries ?? 3;
    const cwd = await this.makeWorktree(task);

    const plan = await this.agent.plan(task, cwd);

    let diff = '';
    let check: CheckResult = { typecheckOk: false, lintOk: null, typecheckRan: false, fault: null };
    let agentThrew = false;
    let agentFault: string | null = null;
    let agentFaultCode: ProviderErrorCode | null = null;

    // The try cap counts the tries that the task already spent. A task with no
    // try left makes no edit.
    if (task.tries < maxTries) {
      try {
        // One pass is one attempt. The runner leaves the loop when the check
        // accepts the attempt, when the tries run out, or when a fault ends
        // the task.
        for (;;) {
          // Count the attempt on the task. The task store holds this object.
          task.tries += 1;
          try {
            await this.agent.edit(task, cwd, plan);
          } catch (error) {
            // A transient provider fault is worth one more attempt while a
            // try remains. This retry exists because a provider throw on the
            // first edit skipped `check = await this.checkCode(cwd)` below,
            // and the evidence then said "typecheckOk did not run" while the
            // bare catch at packages/agent-runner/src/index.ts:221 (commit
            // 547bc28) discarded the provider words.
            if (!retryAllowed(error, task.tries, maxTries)) throw error;
            // Keep the words of the last fault. The next attempt replaces
            // them with its own result.
            agentFault = faultWords(error);
            agentFaultCode = error.code;
            continue;
          }
          // The edit finished. An earlier transient fault is not the end of
          // the task: the check below decides.
          agentFault = null;
          agentFaultCode = null;
          // The diff is evidence. Evidence is measured, never reported. The
          // agent returns a summary, and that summary is often null. So the
          // runner measures the diff itself, from the worktree.
          diff = await worktreeDiff(cwd);
          check = await this.checkCode(cwd);
          // A repair with no change is not a repair. Try again while the
          // check asks for it and the tries remain.
          if (!checkAllowsRetry(check, diff, task.tries, maxTries)) break;
        }
      } catch (error) {
        agentThrew = true;
        // Keep the words of the fault. A failed task with no reason helps
        // nobody.
        agentFault = faultWords(error);
        // A provider fault keeps its code. A worktree or agent fault has no
        // code. The code lets the CLI report the provider state to the panel.
        agentFaultCode = error instanceof ProviderError ? error.code : null;
        try {
          // A partial edit can still be in the worktree. Measure it, so the
          // evidence shows what the agent really did before it failed.
          diff = await worktreeDiff(cwd);
        } catch {
          // The worktree is gone or git failed. Keep the last measurement.
        }
      }
    }

    // The agent fault comes first: it stopped the loop. A failed gate is the
    // other reason. A task that used every try with an empty diff and no
    // fault still needs a reason: the state is failed, and the panel must
    // show why.
    const fault = agentFault ?? check.fault ?? (diff.trim() === '' ? NO_CHANGE_FAULT : null);
    const evidence: Evidence = {
      // A gate that did not run reports null. It never reports a pass and it
      // never reports a failure. A fault after a completed check makes that
      // check stale: the worktree changed after it. Report null then too.
      typecheckOk: !agentThrew && check.typecheckRan ? check.typecheckOk : null,
      lintOk: agentThrew ? null : check.lintOk,
      diff,
      tries: task.tries,
      fault,
      // Only an agent fault can name a provider code. A failed gate has none.
      faultCode: agentFaultCode,
    };

    let state: TaskState = 'failed';
    if (!agentThrew) {
      if (!check.typecheckRan) state = 'unchecked';
      // An empty diff is no repair. A fault is no repair. The state must not
      // say done in either case.
      else if (fault === null && passed(check) && diff.trim() !== '') state = 'done';
    }

    return { evidence, diff, plan, state };
  }
}

export { acceptDiff, worktreeDiff } from './accept.js';
export { ModelAgent } from './agent.js';
export { TOOLS, callTool } from './tools.js';
