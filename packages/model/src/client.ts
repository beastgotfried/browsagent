/**
 * client.ts — the one place that calls a language model.
 *
 * It sends the OpenAI chat shape and maps the answer to ChatResult.
 * It reads the provider body before it names a fault, so the words of the
 * provider survive to the panel. A guardrail refusal is not a network fault.
 */
import type {
  ChatMessage,
  ChatResult,
  ChatUsage,
  ProviderConfig,
  ToolCall,
  ToolSpec,
} from '@browsagent/shared';

import { hasKey } from './config.js';

const TIMEOUT_MS = 120_000;

/** The class of a provider fault. The panel shows this value. */
export type ProviderErrorCode =
  | 'data-policy'
  /** The provider refused a key that is set. This code is not 'no-key'. */
  | 'key-refused'
  | 'no-key'
  | 'no-credit'
  | 'provider';

/** One fault from the provider or from the way to the provider. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  /** The HTTP status. Null when no answer arrived. */
  readonly status: number | null;

  constructor(code: ProviderErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

/** The client of one model provider. The agent loop gets this type. */
export interface ChatClient {
  /** Send one message list. Return one answer. */
  chat(messages: ChatMessage[], tools?: ToolSpec[], model?: string): Promise<ChatResult>;
}

interface WireToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface WireMessage {
  content?: string | null;
  tool_calls?: WireToolCall[];
}

interface WireAnswer {
  choices?: { message?: WireMessage }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/** Make one wire message. The provider speaks the OpenAI shape. */
function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'assistant') {
    const wire: Record<string, unknown> = { role: 'assistant', content: message.content };
    const calls = message.toolCalls ?? [];
    if (calls.length > 0) {
      wire['tool_calls'] = calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    return wire;
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId ?? '',
      content: message.content ?? '',
    };
  }
  return { role: message.role, content: message.content ?? '' };
}

function toWireTool(tool: ToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The most characters of a provider fault that an error message keeps. */
const MAX_WORDS = 500;

/**
 * Remove a key that the provider or a proxy echoed in a fault body.
 *
 * The key must never leave this file. A fault body is not a trusted place: a
 * proxy can put the whole request, headers and all, into the answer. The
 * function removes the configured key itself. Two common key shapes come out
 * too, because another key or a part of one can be in the same body.
 */
function scrubbed(text: string, key: string | null): string {
  const shaped = text
    .replace(/Bearer\s+\S+/gi, 'Bearer <removed>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-<removed>');
  // A value under four characters is no key. The replace would destroy the words.
  if (key === null || key.length < 4) return shaped;
  return shaped.split(key).join('<removed>');
}

/**
 * The words of the provider. Keep them, because they name the reason.
 * Cap them, because the body can be a whole HTML page.
 */
function providerWords(body: unknown, raw: string, key: string | null): string {
  if (typeof body === 'object' && body !== null) {
    const fault = (body as Record<string, unknown>)['error'];
    if (typeof fault === 'object' && fault !== null) {
      const message = (fault as Record<string, unknown>)['message'];
      if (typeof message === 'string' && message.trim() !== '') {
        return scrubbed(message.trim(), key).slice(0, MAX_WORDS);
      }
    }
  }
  const trimmed = scrubbed(raw.trim(), key);
  if (trimmed === '') return 'no words';
  return trimmed.length > MAX_WORDS ? `${trimmed.slice(0, MAX_WORDS)}...` : trimmed;
}

/**
 * Name the fault. The status alone is not enough: the tested account answers a
 * guardrail refusal with HTTP 404, and the reason lives in the body.
 */
function providerFault(
  status: number,
  body: unknown,
  raw: string,
  model: string,
  key: string | null,
): ProviderError {
  const words = providerWords(body, raw, key);

  if (/guardrail|data policy/i.test(`${raw} ${words}`)) {
    return new ProviderError(
      'data-policy',
      `The model ${model} is blocked by guardrail or data policy. ` +
        `Change the privacy setting at openrouter.ai/settings/privacy. ` +
        `The provider said: ${words}`,
      status,
    );
  }
  if (status === 401) {
    return new ProviderError(
      'key-refused',
      `The provider refused the API key with HTTP 401. ` +
        `Set BROWSAGENT_API_KEY, or put the key in the config file. ` +
        `The provider said: ${words}`,
      status,
    );
  }
  if (status === 402) {
    return new ProviderError(
      'no-credit',
      `The account has no credit for the model ${model} (HTTP 402). ` +
        `The provider said: ${words}`,
      status,
    );
  }
  return new ProviderError(
    'provider',
    `The provider refused the model ${model} with HTTP ${status}. ` +
      `The provider said: ${words}`,
    status,
  );
}

/** The client of one model provider. */
export class ModelClient implements ChatClient {
  constructor(private readonly config: ProviderConfig) {}

  async chat(messages: ChatMessage[], tools?: ToolSpec[], model?: string): Promise<ChatResult> {
    const wanted = model ?? this.config.model;
    if (!hasKey(this.config)) {
      throw new ProviderError(
        'no-key',
        `No API key. The model ${wanted} needs a key. ` +
          `Set BROWSAGENT_API_KEY, or put the key in the config file.`,
      );
    }

    const body: Record<string, unknown> = {
      model: wanted,
      messages: messages.map(toWireMessage),
    };
    if (tools !== undefined && tools.length > 0) {
      body['tools'] = tools.map(toWireTool);
      body['tool_choice'] = 'auto';
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);

    let response: Response;
    let raw: string;
    try {
      const base = this.config.apiBase.replace(/\/+$/, '');
      response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      raw = await response.text();
    } catch (error) {
      // No answer arrived. Only this case is a network fault.
      const reason = error instanceof Error ? error.message : String(error);
      const words = timedOut
        ? `The provider did not answer in ${TIMEOUT_MS / 1000} seconds.`
        : `Network fault. The provider did not answer: ${reason}`;
      throw new ProviderError('provider', words);
    } finally {
      clearTimeout(timer);
    }

    const parsed = parseJson(raw);
    if (!response.ok) {
      throw providerFault(response.status, parsed, raw, wanted, this.config.apiKey);
    }
    if (parsed === null) {
      throw new ProviderError('provider', `The provider answer is not JSON. The model is ${wanted}.`);
    }

    const answer = parsed as WireAnswer;
    const message = answer.choices?.[0]?.message;
    if (message === undefined) {
      throw new ProviderError('provider', `The provider answer holds no choice. The model is ${wanted}.`);
    }

    const toolCalls: ToolCall[] = [];
    for (const call of message.tool_calls ?? []) {
      const fn = call.function;
      if (fn?.name === undefined || fn.name === '') continue;
      toolCalls.push({
        id: call.id ?? '',
        name: fn.name,
        arguments: fn.arguments ?? '{}',
      });
    }

    const usage: ChatUsage = {
      input: numberOrZero(answer.usage?.prompt_tokens),
      output: numberOrZero(answer.usage?.completion_tokens),
    };

    return {
      content: typeof message.content === 'string' ? message.content : null,
      toolCalls,
      usage,
    };
  }
}
