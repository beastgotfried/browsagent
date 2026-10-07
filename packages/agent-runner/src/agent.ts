/**
 * agent.ts — the model agent.
 *
 * The agent is a plain tool loop. There is no agent framework.
 * Every model call sends three messages: the fixed instructions, the project
 * context, and the task. Read `docs/CONTEXT.md`.
 */
import type { ChatClient } from '@browsagent/model';
import type { ChatMessage, ProjectContext, Task } from '@browsagent/shared';

import type { Agent, AgentPlan } from './index.js';
import { TOOLS, callTool } from './tools.js';

/** The largest number of model turns in one repair. */
const MAX_TURNS = 12;

/**
 * The fixed instructions. Every model call gets this text as the first
 * system message. The text is the same for the plan call and the repair.
 */
const INSTRUCTIONS = [
  'You repair one element of a web page.',
  'Make the smallest change that repairs the problem.',
  'Use the project context. Do not break an invariant.',
  'Do not add a dependency.',
  'Do not reformat a file that you did not need to change.',
  'Read a file before you write it.',
  'Use the tools. There is no shell tool.',
  'When you are done, say which files you changed and why.',
].join('\n');

/** The task as text. The text holds the record and the problem. */
function taskText(task: Task): string {
  return [
    `The task id is ${task.id}.`,
    `The route is ${task.route}.`,
    '',
    'The record of the marked element:',
    JSON.stringify(task.record, null, 2),
    '',
    'The problem:',
    JSON.stringify(task.problem, null, 2),
  ].join('\n');
}

/** The question for the plan call. The plan call has no tools. */
const PLAN_QUESTION = [
  'Make a short plan for the repair.',
  'You have no tools in this call. Do not write a tool call.',
  'Name the files that you will change.',
  'Answer with one JSON object and nothing else:',
  '{"plan": "the short plan", "files": ["a/path.ts"]}',
].join('\n');

/** Read the plan and the files from the answer. Keep the words when the answer is not JSON. */
function parsePlan(text: string): AgentPlan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { text, files: [] };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { text, files: [] };
  }

  const plan = typeof raw['plan'] === 'string' ? raw['plan'].trim() : '';
  const files = Array.isArray(raw['files'])
    ? raw['files'].filter((file): file is string => typeof file === 'string' && file.trim() !== '')
    : [];
  return { text: plan === '' ? text : plan, files };
}

/** The agent that answers with one model provider. */
export class ModelAgent implements Agent {
  constructor(
    private readonly client: ChatClient,
    private readonly context: ProjectContext | null,
  ) {}

  /** The start messages: the instructions, the context, and the task. */
  private start(task: Task, question: string | null): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: INSTRUCTIONS }];
    if (this.context !== null) {
      messages.push({ role: 'system', content: this.context.markdown });
    }
    const body = taskText(task);
    messages.push({
      role: 'user',
      content: question === null ? body : `${body}\n\n${question}`,
    });
    return messages;
  }

  /** Ask for a short plan and the files. One call. No tools. */
  async plan(task: Task, _cwd: string): Promise<AgentPlan> {
    const answer = await this.client.chat(this.start(task, PLAN_QUESTION));
    return parsePlan(answer.content ?? '');
  }

  /**
   * Make the repair. The tool loop:
   * 1. Send the messages and the tools.
   * 2. Run each tool call and append the result as one tool message.
   * 3. Stop when the answer holds no tool call.
   * The loop stops after MAX_TURNS in every other case.
   */
  async edit(task: Task, cwd: string): Promise<string> {
    const messages = this.start(task, null);
    let text = '';

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const answer = await this.client.chat(messages, TOOLS);
      text = answer.content ?? '';
      messages.push({ role: 'assistant', content: answer.content, toolCalls: answer.toolCalls });
      if (answer.toolCalls.length === 0) return text;

      for (const call of answer.toolCalls) {
        messages.push({
          role: 'tool',
          content: await callTool(call.name, call.arguments, cwd),
          toolCallId: call.id,
          name: call.name,
        });
      }
    }

    return text;
  }
}
