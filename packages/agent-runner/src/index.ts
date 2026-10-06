import { spawn } from 'node:child_process';

import type { Evidence, Task } from '@browsagent/shared';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run one command. Return the code and the output. */
export function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export interface RunnerOptions {
  /** The root of the project. */
  root: string;
  /** The directory for the worktrees. */
  worktreeDir: string;
  /** The maximum number of tries for one task. */
  maxTries?: number;
  /** The command for the type check. */
  typecheck?: string;
  /** The command for the lint. */
  lint?: string;
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
  /** Make the change. The agent returns a diff. */
  edit(task: Task, cwd: string): Promise<string>;
}

/**
 * Phase 3 of the pipeline.
 *
 * The runner does five steps for each task:
 * 1. Make one worktree. One worktree for each task gives true separation.
 * 2. Ask the agent for a plan. Send the plan to the panel.
 * 3. Ask the agent for the edit.
 * 4. Check the result: type check, lint, and the pixel check.
 * 5. Return the evidence.
 */
export class AgentRunner {
  constructor(
    private readonly options: RunnerOptions,
    private readonly agent: Agent,
  ) {}

  /** Make one worktree for one task. */
  async makeWorktree(task: Task): Promise<string> {
    const dir = `${this.options.worktreeDir}/${task.id.slice(0, 8)}`;
    await run('git', ['worktree', 'add', dir, 'HEAD'], this.options.root);
    return dir;
  }

  /** Remove the worktree of one task. */
  async removeWorktree(task: Task): Promise<void> {
    const dir = `${this.options.worktreeDir}/${task.id.slice(0, 8)}`;
    await run('git', ['worktree', 'remove', '--force', dir], this.options.root);
  }

  /** Check the code. Return true if the code is correct. */
  async checkCode(cwd: string): Promise<{ typecheckOk: boolean; lintOk: boolean }> {
    const typecheckOk = this.options.typecheck
      ? (await run('sh', ['-c', this.options.typecheck], cwd)).code === 0
      : true;
    const lintOk = this.options.lint
      ? (await run('sh', ['-c', this.options.lint], cwd)).code === 0
      : true;
    return { typecheckOk, lintOk };
  }

  /**
   * Run one task.
   *
   * The pixel check is not in this scaffold. A later step adds it:
   * 1. Take a picture at each screen width before the repair.
   * 2. Take the same pictures after the repair.
   * 3. Compare the pictures. If a picture gets worse, the task fails.
   */
  async run(task: Task): Promise<{ evidence: Evidence; diff: string; plan: AgentPlan }> {
    const maxTries = this.options.maxTries ?? 3;
    const cwd = await this.makeWorktree(task);

    const plan = await this.agent.plan(task, cwd);
    const diff = await this.agent.edit(task, cwd);
    const code = await this.checkCode(cwd);

    const evidence: Evidence = {
      before: [],
      after: [],
      accessOk: true,
      typecheckOk: code.typecheckOk,
      lintOk: code.lintOk,
      regression: false,
    };

    void maxTries;
    return { evidence, diff, plan };
  }
}
