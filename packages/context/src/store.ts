/**
 * store.ts — read and write the project context.
 *
 * The context lives in <root>/.browsagent. The markdown file holds the
 * document. The JSON file holds the record of the pass. The record holds the
 * commit, the model, the token count, the time, and the digest of the
 * document. The digest pairs the two files: a reader must never show a part
 * of one pass with a part of another pass.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectContext } from '@browsagent/shared';

const CONTEXT_DIR = '.browsagent';
const MARKDOWN_FILE = 'context.md';
const RECORD_FILE = 'context.json';

/** The record of the pass. The markdown is not in this record. */
interface ContextRecord {
  commit: string;
  model: string;
  tokens: number;
  madeAt: string;
  /** The SHA-256 digest of the markdown. It joins the record to the document. */
  sha256: string;
}

/** The digest of one document. The record holds this value. */
function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function recordOf(context: ProjectContext): ContextRecord {
  return {
    commit: context.commit,
    model: context.model,
    tokens: context.tokens,
    madeAt: context.madeAt,
    sha256: digest(context.markdown),
  };
}

/**
 * Write one file through a temporary name.
 *
 * A reader sees the old file or the new file. The reader never sees a part of
 * a file that a writer still holds.
 */
async function writeAtomic(path: string, text: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, text, 'utf8');
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Write the document and the record. Make the directory when it is absent. */
export async function writeContext(root: string, context: ProjectContext): Promise<void> {
  const dir = join(root, CONTEXT_DIR);
  await mkdir(dir, { recursive: true });
  // Write the document first. The record holds its digest, so a reader that
  // reads a mixed pair refuses the pair.
  await writeAtomic(join(dir, MARKDOWN_FILE), context.markdown);
  await writeAtomic(join(dir, RECORD_FILE), `${JSON.stringify(recordOf(context), null, 2)}\n`);
}

/** Read the document and the record. Return null when a file is absent or bad. */
export async function readContext(root: string): Promise<ProjectContext | null> {
  const dir = join(root, CONTEXT_DIR);

  let markdown: string;
  let raw: string;
  try {
    markdown = await readFile(join(dir, MARKDOWN_FILE), 'utf8');
    raw = await readFile(join(dir, RECORD_FILE), 'utf8');
  } catch {
    return null;
  }

  let record: unknown;
  try {
    record = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null) return null;

  const { commit, model, tokens, madeAt, sha256 } = record as Record<string, unknown>;
  if (typeof commit !== 'string' || typeof model !== 'string') return null;
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return null;
  if (typeof madeAt !== 'string') return null;
  // A record from an older version holds no digest. The check does not run for
  // that record.
  if (sha256 !== undefined) {
    if (typeof sha256 !== 'string' || sha256 !== digest(markdown)) return null;
  }

  return { markdown, commit, model, tokens, madeAt };
}

/** True when HEAD has moved since the pass. A stale context does not block a repair. */
export function isStale(context: ProjectContext, currentCommit: string): boolean {
  return context.commit !== currentCommit;
}
