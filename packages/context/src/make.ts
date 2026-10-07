/**
 * make.ts — make the project context with one model call.
 *
 * The context pass calls the cheap model one time. The system message fixes
 * the shape. The user message holds the project sample. The document goes
 * into every repair call, so it must stay under 1500 tokens.
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

  return {
    markdown: answer.content,
    commit,
    model,
    tokens: answer.usage.input + answer.usage.output,
    madeAt: new Date().toISOString(),
  };
}
