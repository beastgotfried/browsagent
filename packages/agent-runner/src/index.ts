import { spawn } from 'node:child_process';

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
   */
  edit(task: Task, cwd: string): Promise<string>;
}

/** The result of the code check. */
interface CheckResult {
  /** True when the type check passed. */
  typecheckOk: boolean;
  /** True when the lint passed. Null when the lint did not run. */
  lintOk: boolean | null;
  /** True when every configured gate started. */
  ran: boolean;
}

/** True when every gate that ran passed. */
function passed(check: CheckResult): boolean {
  return check.typecheckOk && check.lintOk !== false;
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
      // The required gate did not start. No other gate can help.
      return { typecheckOk: false, lintOk: null, ran: false };
    }

    const lintCommand = this.options.lint?.trim();
    const lint =
      lintCommand === undefined || lintCommand === ''
        ? null
        : await run('sh', ['-c', lintCommand], cwd);

    return {
      typecheckOk: typecheck.code === 0,
      // A lint that did not start did not run. The value is null.
      lintOk: lint === null || !lint.started ? null : lint.code === 0,
      ran: lint === null || lint.started,
    };
  }

  /**
   * Run one task.
   *
   * The runner asks for one plan. Then it asks for one edit for each try. It
   * checks the code after each edit. It tries again while the check fails and
   * the try count is under maxTries.
   *
   * The state tells the truth about the check:
   * - `done`: the agent made an edit, the diff is not empty, and every gate
   *   that ran passed.
   * - `failed`: a gate failed after maxTries, the diff stayed empty, or the
   *   agent threw a fault.
   * - `unchecked`: no gate ran.
   */
  async run(
    task: Task,
  ): Promise<{ evidence: Evidence; diff: string; plan: AgentPlan; state: TaskState }> {
    const maxTries = this.options.maxTries ?? 3;
    const cwd = await this.makeWorktree(task);

    const plan = await this.agent.plan(task, cwd);

    let diff = '';
    let check: CheckResult = { typecheckOk: false, lintOk: null, ran: false };
    let agentThrew = false;

    // The try cap counts the tries that the task already spent. A task with no
    // try left makes no edit.
    if (task.tries < maxTries) {
      try {
        do {
          // Count the attempt on the task. The task store holds this object.
          task.tries += 1;
          await this.agent.edit(task, cwd);
          // The diff is evidence. Evidence is measured, never reported. The
          // agent returns a summary, and that summary is often null. So the
          // runner measures the diff itself, from the worktree.
          diff = await worktreeDiff(cwd);
          check = await this.checkCode(cwd);
          // A repair with no change is not a repair. Try again.
        } while (check.ran && (!passed(check) || diff.trim() === '') && task.tries < maxTries);
      } catch {
        agentThrew = true;
        try {
          // A partial edit can still be in the worktree. Measure it, so the
          // evidence shows what the agent really did before it failed.
          diff = await worktreeDiff(cwd);
        } catch {
          // The worktree is gone or git failed. Keep the last measurement.
        }
      }
    }

    const evidence: Evidence = {
      // A gate that did not run reports null. It never reports a pass and it
      // never reports a failure.
      typecheckOk: check.ran ? check.typecheckOk : null,
      lintOk: check.lintOk,
      diff,
    };

    let state: TaskState = 'failed';
    if (!agentThrew) {
      if (!check.ran) state = 'unchecked';
      // An empty diff is no repair. The state must not say done.
      else if (passed(check) && diff.trim() !== '') state = 'done';
    }

    return { evidence, diff, plan, state };
  }
}

export { acceptDiff, worktreeDiff } from './accept.js';
export { ModelAgent } from './agent.js';
export { TOOLS, callTool } from './tools.js';
