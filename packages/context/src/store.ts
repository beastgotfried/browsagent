/**
 * store.ts — read and write the project context.
 *
 * The context lives in <root>/.browsagent. The markdown file holds the
 * document. The JSON file holds the record of the pass. The record holds the
 * commit, the model, the token count, and the time.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
}

function recordOf(context: ProjectContext): ContextRecord {
  return {
    commit: context.commit,
    model: context.model,
    tokens: context.tokens,
    madeAt: context.madeAt,
  };
}

/** Write the document and the record. Make the directory when it is absent. */
export async function writeContext(root: string, context: ProjectContext): Promise<void> {
  const dir = join(root, CONTEXT_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MARKDOWN_FILE), context.markdown, 'utf8');
  await writeFile(join(dir, RECORD_FILE), `${JSON.stringify(recordOf(context), null, 2)}\n`, 'utf8');
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

  const { commit, model, tokens, madeAt } = record as Record<string, unknown>;
  if (typeof commit !== 'string' || typeof model !== 'string') return null;
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return null;
  if (typeof madeAt !== 'string') return null;

  return { markdown, commit, model, tokens, madeAt };
}

/** True when HEAD has moved since the pass. A stale context does not block a repair. */
export function isStale(context: ProjectContext, currentCommit: string): boolean {
  return context.commit !== currentCommit;
}
