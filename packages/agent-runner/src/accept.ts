/**
 * accept.ts — apply the diff of one task to the working tree.
 *
 * D9: the agent shows a diff and never lands a commit. The user accepts, and
 * the tool applies the patch with `git apply`. The user commits with their
 * own tooling.
 *
 * Proof that one call makes no commit and no branch:
 * 1. The plain `git apply` writes the files of the patch in the working tree.
 *    It writes no index entry, no object, and no ref. `git apply --index` and
 *    `git apply --cached` write to the index; this file uses neither.
 * 2. This file runs no `git commit`, no `git branch`, and no `git checkout`.
 *    A commit and a branch both move a ref. No command here writes a ref.
 * 3. The patch lives in a temporary directory outside the project. The
 *    temporary file cannot join the working tree.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AcceptResult } from '@browsagent/shared';

import { run } from './index.js';
import type { CommandResult } from './index.js';

/** The name of the patch file inside the temporary directory. */
const PATCH_FILE = 'repair.diff';

/** The words of one git command. Git writes a refusal to stderr. */
function gitWords(result: CommandResult): string {
  const words = (result.stderr.trim() === '' ? result.stdout : result.stderr).trim();
  return words === '' ? 'git gave no message.' : words;
}

/** The words of one fault value. */
function faultWords(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the file names from the patch headers.
 *
 * The `--- a/...` line names the old file. The `+++ b/...` line names the new
 * file. A `/dev/null` side names nothing. One name comes out one time only.
 */
function filesOf(diff: string): string[] {
  const names = new Set<string>();
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- a/')) names.add(line.slice('--- a/'.length));
    else if (line.startsWith('+++ b/')) names.add(line.slice('+++ b/'.length));
  }
  return [...names];
}

/** The report for an applied patch. */
function appliedWords(files: string[]): string {
  const count = files.length === 1 ? '1 file' : `${files.length} files`;
  return [
    `The patch is in the working tree. The patch touches ${count}.`,
    'The tool made no commit and no branch. The user commits with their own tooling.',
  ].join(' ');
}

/**
 * Apply one diff to the working tree.
 *
 * The steps:
 * 1. Write the diff to a temporary file outside the project.
 * 2. Run `git apply --check`. This step changes no file. A refusal stops here.
 * 3. Run `git apply`. This step writes the files.
 * 4. Remove the temporary file.
 *
 * A refused patch returns `applied: false` and the exact words of git. An
 * empty diff returns `applied: false` with no git call. A patch with no
 * `a/...` or `b/...` header gives an empty `files` list; git decides the
 * apply in every case.
 */
export async function acceptDiff(root: string, diff: string): Promise<AcceptResult> {
  if (diff.trim() === '') {
    return { applied: false, files: [], message: 'The diff is empty. There is no patch to apply.' };
  }

  const files = filesOf(diff);

  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), 'browsagent-accept-'));
    await writeFile(join(dir, PATCH_FILE), diff, 'utf8');
  } catch (error) {
    return { applied: false, files, message: `The tool cannot write the patch file: ${faultWords(error)}` };
  }

  const patch = join(dir, PATCH_FILE);
  try {
    const check = await run('git', ['apply', '--check', patch], root);
    if (check.code !== 0) return { applied: false, files, message: gitWords(check) };

    const apply = await run('git', ['apply', patch], root);
    if (apply.code !== 0) return { applied: false, files, message: gitWords(apply) };

    return { applied: true, files, message: appliedWords(files) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Read the diff of one worktree.
 *
 * D5: the diff is the measure of a repair. There is no picture check.
 *
 * Plain `git diff` reads the tracked files of the worktree. It does not read
 * a new file that no `git add` records.
 */
export async function worktreeDiff(cwd: string): Promise<string> {
  const result = await run('git', ['diff'], cwd);
  return result.stdout;
}
