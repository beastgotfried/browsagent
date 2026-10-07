/**
 * index.ts — the provider package.
 *
 * The companion imports this package. The extension never does: the key must
 * not reach the browser.
 */
export { ModelClient, ProviderError, scrubKey } from './client.js';
export type { ChatClient, ProviderErrorCode } from './client.js';
export { hasKey, loadProviderConfig, loadToken } from './config.js';
