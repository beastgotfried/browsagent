/**
 * config.ts — resolve the four provider values and the shared token.
 *
 * The companion holds the key. The key never goes to the browser.
 * The first source with a value wins for each field:
 *   1. the environment,
 *   2. <root>/.browsagent/config.json,
 *   3. ~/.pi/agent/auth.json (the pi provider store).
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ProviderConfig } from '@browsagent/shared';

const DEFAULT_API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = '~deepseek/deepseek-pro-latest';
const DEFAULT_MODEL_CHEAP = '~deepseek/deepseek-v4-flash-latest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Return the value when it is a text with content. Return null in every other case. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read one JSON file. Return null for a missing file and for a bad file.
 *
 * This function does not report the fault. The parse words can hold a part of
 * the file, and the file can hold the key. A report would leak the key.
 */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function fromEnv(name: string): string | null {
  return text(process.env[name]);
}

/** True when a key is set. A repair is off without a key. */
export function hasKey(config: ProviderConfig): boolean {
  return text(config.apiKey) !== null;
}

/** Resolve the four provider values. This function never throws for a missing key. */
export async function loadProviderConfig(root: string): Promise<ProviderConfig> {
  const project = await readJson(join(root, '.browsagent', 'config.json'));
  const pi = await readJson(join(homedir(), '.pi', 'agent', 'auth.json'));

  const file = isRecord(project) ? project : {};
  const piKey = isRecord(pi) && isRecord(pi['openrouter']) ? text(pi['openrouter']['key']) : null;

  return {
    apiKey: fromEnv('BROWSAGENT_API_KEY') ?? text(file['apiKey']) ?? piKey,
    apiBase: fromEnv('BROWSAGENT_API_BASE') ?? text(file['apiBase']) ?? DEFAULT_API_BASE,
    model: fromEnv('BROWSAGENT_MODEL') ?? text(file['model']) ?? DEFAULT_MODEL,
    modelCheap: fromEnv('BROWSAGENT_MODEL_CHEAP') ?? text(file['modelCheap']) ?? DEFAULT_MODEL_CHEAP,
  };
}

/**
 * Resolve the shared token of the companion.
 *
 * The token is not a provider value, but it lives in the same two places. The
 * extension makes the token and shows it on the options page. The companion
 * refuses a socket and a request that holds a different token. The environment
 * wins over the project file. The answer is null when no source holds a token.
 */
export async function loadToken(root: string): Promise<string | null> {
  const project = await readJson(join(root, '.browsagent', 'config.json'));
  const file = isRecord(project) ? project : {};
  return fromEnv('BROWSAGENT_TOKEN') ?? text(file['token']);
}
