/**
 * tools.ts — the three tools of the agent.
 *
 * The agent reads and writes files in one worktree. There is no shell tool: a
 * shell can run any command, so the repair could leave the worktree.
 *
 * Every path is relative to the worktree root. Every path must stay inside
 * the root. The test in your head:
 * 1. An absolute path is refused. Example: /etc/passwd.
 * 2. A path with a '..' part is refused. Example: ../../etc/passwd. The
 *    check reads the parts of the path, so the work starts before any file
 *    system call.
 * 3. The resolved path must be the root itself or a child of the root.
 *    `relative(root, full)` gives '' for the root and a path with no leading
 *    '..' for a child. Any other value names a place above the root, so the
 *    code refuses the path.
 * Step 3 is the proof. Steps 1 and 2 give a clear answer for the two common
 * mistakes.
 *
 * Step 3 must read the real path too. A symbolic link inside the worktree can
 * point outside it. The real path of the link target is the thing to compare.
 * A missing part is not a fault: write_file makes a missing directory.
 */
import { lstat, mkdir, readdir, readFile, readlink, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { ToolSpec } from '@browsagent/shared';

/** The most names that list_files returns. */
const MAX_NAMES = 200;

/** The largest file that read_file returns. 200 KB. */
const MAX_FILE_BYTES = 200 * 1024;

/** The names that list_files hides. */
const HIDDEN = new Set(['node_modules', '.git']);

/** The three tools. Nothing else. */
export const TOOLS: ToolSpec[] = [
  {
    name: 'list_files',
    description:
      'List the names in one directory. The tool reads one level. It hides node_modules and .git.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory, relative to the worktree root. Use "." for the root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read one file. The tool puts a line number on each line. You can cite a line.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file, relative to the worktree root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write the whole file. The tool makes a missing directory. Read the file before you write it.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file, relative to the worktree root.',
        },
        content: {
          type: 'string',
          description: 'The whole new content of the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
];

type PathCheck = { ok: true; full: string; shown: string } | { ok: false; text: string };

/**
 * Resolve one path against the worktree root.
 * Return the full path when it stays inside the root.
 */
function inside(root: string, given: unknown): PathCheck {
  if (typeof given !== 'string' || given.trim() === '') {
    return { ok: false, text: 'Give a path as a text value.' };
  }
  if (isAbsolute(given)) {
    return { ok: false, text: `The path ${given} is absolute. Give a path inside the worktree.` };
  }
  if (given.split(/[\\/]/).includes('..')) {
    return { ok: false, text: `The path ${given} holds '..'. It can leave the worktree.` };
  }

  const base = resolve(root);
  const full = resolve(base, given);
  const back = relative(base, full);
  if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    return { ok: false, text: `The path ${given} is outside the worktree.` };
  }
  return { ok: true, full, shown: back === '' ? '.' : back };
}

/**
 * Check the REAL path of one location.
 *
 * `inside` reads the parts of a path. It does not follow a symbolic link. So a
 * link inside the worktree can still point outside it. Resolve the link and
 * compare the real paths. A link that leaves the worktree is refused.
 *
 * A new file does not exist yet, so the resolve of the file itself fails. Then
 * the walk goes up to the nearest part that exists. A symbolic link is
 * followed by its own text, so a dangling link is checked as well: the write
 * call would create the target of that link.
 */
async function insideReal(root: string, check: PathCheck): Promise<PathCheck> {
  if (!check.ok) return check;

  let base: string;
  try {
    base = await realpath(resolve(root));
  } catch {
    return { ok: false, text: `The path ${check.shown} cannot be resolved.` };
  }

  let target = check.full;
  // The walk goes up one level for each part that does not exist. The cap
  // stops a loop.
  for (let step = 0; step < 64; step += 1) {
    let real: string | null = null;
    try {
      real = await realpath(target);
    } catch {
      real = null;
    }
    if (real !== null) {
      const back = relative(base, real);
      if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) {
        return {
          ok: false,
          text: `The path ${check.shown} leaves the worktree through a symbolic link.`,
        };
      }
      return check;
    }

    const link = await lstat(target).catch(() => null);
    if (link !== null && link.isSymbolicLink()) {
      const text = await readlink(target).catch(() => null);
      if (text === null) {
        return { ok: false, text: `The path ${check.shown} cannot be resolved.` };
      }
      target = resolve(dirname(target), text);
      continue;
    }

    const parent = dirname(target);
    if (parent === target) break;
    target = parent;
  }

  return { ok: false, text: `The path ${check.shown} cannot be resolved.` };
}

/** Resolve one path and then check the real path. */
async function safePath(root: string, given: unknown): Promise<PathCheck> {
  return insideReal(root, inside(root, given));
}

/** List the names in one directory. One level. */
async function listFiles(root: string, given: unknown): Promise<string> {
  const path = await safePath(root, given);
  if (!path.ok) return path.text;

  let entries;
  try {
    entries = await readdir(path.full, { withFileTypes: true });
  } catch {
    return `The path ${path.shown} is not a directory that the tool can read.`;
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (HIDDEN.has(entry.name)) continue;
    names.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
  }
  names.sort();

  const shown = names.slice(0, MAX_NAMES);
  if (shown.length === 0) return `The directory ${path.shown} is empty.`;

  const body = shown.join('\n');
  if (names.length > MAX_NAMES) {
    return `The directory ${path.shown} holds more than ${MAX_NAMES} names. The first ${MAX_NAMES} names:\n${body}`;
  }
  const count = names.length === 1 ? '1 name' : `${names.length} names`;
  return `The directory ${path.shown} holds ${count}:\n${body}`;
}

/** Read one file and put a line number on each line. */
async function readFileText(root: string, given: unknown): Promise<string> {
  const path = await safePath(root, given);
  if (!path.ok) return path.text;

  let info;
  try {
    info = await stat(path.full);
  } catch {
    return `The file ${path.shown} does not exist.`;
  }
  if (!info.isFile()) return `The path ${path.shown} is not a file.`;
  if (info.size > MAX_FILE_BYTES) {
    return `The file ${path.shown} is ${info.size} bytes. The limit is ${MAX_FILE_BYTES} bytes.`;
  }

  let text: string;
  try {
    text = await readFile(path.full, 'utf8');
  } catch {
    return `The file ${path.shown} is not readable.`;
  }
  if (text === '') return `The file ${path.shown} is empty.`;

  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const width = String(lines.length).length;
  const body = lines
    .map((line, index) => `${String(index + 1).padStart(width)}: ${line}`)
    .join('\n');
  const count = lines.length === 1 ? '1 line' : `${lines.length} lines`;
  return `The file ${path.shown} holds ${count}:\n${body}`;
}

/** Write the whole file. Make a missing directory. */
async function writeFileText(root: string, given: unknown, content: unknown): Promise<string> {
  const path = await safePath(root, given);
  if (!path.ok) return path.text;
  // The path .git is the pointer of the worktree. A write there destroys the
  // worktree, and the damage does not show in the diff. The tool never writes it.
  if (path.shown === '.git' || path.shown.startsWith(`.git${sep}`)) {
    return 'The path .git is not writable. The tools change source files only.';
  }
  if (typeof content !== 'string') {
    return 'Give the content as a text value. The tool writes the whole file.';
  }

  try {
    await mkdir(dirname(path.full), { recursive: true });
    await writeFile(path.full, content, 'utf8');
  } catch {
    return `The file ${path.shown} is not writable.`;
  }
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path.shown}.`;
}

/** Read the arguments. Return null when they are not one JSON object. */
function argsOf(argsJson: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Run one tool by name.
 *
 * A bad name and a bad argument give a text answer. The call does not throw.
 * The model reads the text and tries again.
 */
export async function callTool(name: string, argsJson: string, cwd: string): Promise<string> {
  const args = argsOf(argsJson);
  if (args === null) return `The arguments of ${name} are not one JSON object.`;

  if (name === 'list_files') return listFiles(cwd, args['path']);
  if (name === 'read_file') return readFileText(cwd, args['path']);
  if (name === 'write_file') return writeFileText(cwd, args['path'], args['content']);
  return `No tool is named ${name}. The tools are list_files, read_file, and write_file.`;
}
