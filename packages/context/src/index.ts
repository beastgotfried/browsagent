/**
 * index.ts — the project context package.
 *
 * The companion imports this package. The browser never does. The document
 * goes into every repair call as the second system message.
 */
export { makeContext } from './make.js';
export { readSample } from './sample.js';
export { isStale, readContext, writeContext } from './store.js';
