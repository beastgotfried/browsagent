/**
 * make.ts — make the project context with one model call.
 *
 * The context pass calls the cheap model one time. The system message fixes
 * the shape. The user message holds the project sample. The document goes
 * into every repair call, so it must stay under 1500 tokens. The model is not
 * a trusted formatter: this file reads the answer and holds the five parts to
 * their line limits.
 */
import type { ChatClient } from '@browsagent/model';
import type { ChatMessage, ProjectContext } from '@browsagent/shared';

import { readSample } from './sample.js';

/**
 * The fixed instructions of the context pass.
 *
 * The heading list and the line limits are part of this message. The model
 * must not choose a different shape.
 */
const SYSTEM_MESSAGE = [
  'You write one short document about a software project.',
  'The document goes into every later model call. It must stay under 1500 tokens.',
  'Write markdown with exactly these five headings, in this order:',
  '## What this project is',
  '## The frontend',
  '## The backend',
  '## The invariants',
  '## The map',
  'Line limits: the first heading 5 lines, the frontend 15 lines, the backend 15 lines,',
  'the invariants 10 lines, and the map 10 lines.',
  'The invariants are the important part. Each invariant must name the file that proves it.',
  'The map holds the 10 files that an agent most often needs.',
  'Use only the facts in the sample. Do not invent a file or a command.',
].join('\n');

/**
 * The five parts of the document. The order is fixed.
 */
const HEADINGS = [
  '## What this project is',
  '## The frontend',
  '## The backend',
  '## The invariants',
  '## The map',
] as const;

/** The line limit of each part. This list has the same order as HEADINGS. */
const LINE_LIMITS = [5, 15, 15, 10, 10] as const;

/** The largest size of the document, in tokens. */
const MAX_TOKENS = 1500;

/** The number of characters that the tool counts as one token. It has no tokenizer. */
const CHARS_PER_TOKEN = 4;

/** The token estimate of one text. The tool counts one token for every four characters. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Keep the first lines of one part. Drop the empty lines at the end. */
function capLines(lines: string[], limit: number): string[] {
  const kept = lines.slice(0, limit);
  while (kept.length > 0 && kept[kept.length - 1]?.trim() === '') kept.pop();
  return kept;
}

/**
 * Read the answer. Keep the five parts and their line limits.
 *
 * The model must give the five headings in order. A missing heading and a
 * wrong order are faults: the shape of the document is part of the contract
 * in `docs/CONTEXT.md`. A part over its line limit is cut to the limit.
 */
function capAnswer(markdown: string): string {
  const starts: number[] = [];
  for (const heading of HEADINGS) starts.push(markdown.indexOf(heading));

  for (let at = 0; at < HEADINGS.length; at += 1) {
    if (starts[at] === -1) {
      throw new Error(
        `The context answer has no "${HEADINGS[at]}" part. The shape of the document is wrong.`,
      );
    }
    if (at > 0 && (starts[at] ?? 0) < (starts[at - 1] ?? 0)) {
      throw new Error(
        `The context answer puts "${HEADINGS[at]}" before "${HEADINGS[at - 1]}". ` +
          'The shape of the document is wrong.',
      );
    }
  }

  const parts: string[] = [];
  for (let at = 0; at < HEADINGS.length; at += 1) {
    const start = starts[at] ?? 0;
    const end = at + 1 < HEADINGS.length ? (starts[at + 1] ?? markdown.length) : markdown.length;
    const block = markdown.slice(start, end).split('\n');
    const heading = (block[0] ?? HEADINGS[at] ?? '').trim();
    const body = capLines(block.slice(1), LINE_LIMITS[at] ?? 0);
    parts.push([heading, ...body].join('\n').trimEnd());
  }
  return parts.join('\n\n');
}

/**
 * Make the project context with one model call.
 *
 * The caller passes the cheap model in the model argument. The context pass is
 * a summary job, so it must not use the strong model.
 */
export async function makeContext(
  root: string,
  client: ChatClient,
  commit: string,
  model: string,
): Promise<ProjectContext> {
  const sample = await readSample(root);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: sample },
  ];

  const answer = await client.chat(messages, undefined, model);
  if (answer.content === null || answer.content.trim() === '') {
    throw new Error(`The model gave no context words. The model is ${model}.`);
  }

  const markdown = capAnswer(answer.content);
  const tokens = estimateTokens(markdown);
  if (tokens > MAX_TOKENS) {
    throw new Error(
      `The context answer is ${tokens} tokens. The limit is ${MAX_TOKENS}. Make the context again.`,
    );
  }

  return {
    markdown,
    commit,
    model,
    tokens,
    madeAt: new Date().toISOString(),
  };
}
