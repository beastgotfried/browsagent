import path from 'node:path';

import { transformSync } from '@babel/core';
import type { Plugin } from 'vite';

import { STAMP } from '@browsagent/shared';

import { jsxStamp } from './jsx-stamp.js';

export interface StampOptions {
  /** The root of the project source. */
  root: string;
  /** True to add the stamp to the files in node_modules. */
  includeDependencies?: boolean;
  /** The path of the client script. This path goes into the page. */
  clientPath?: string;
}

/**
 * Phase 1 of the pipeline.
 *
 * This plugin adds the source stamp to each element in the development build.
 * The stamp holds the original file, line, and column. Therefore the pipeline
 * does not need source maps for the markup step.
 */
export function stampPlugin(options: StampOptions): Plugin {
  const root = options.root;
  const clientPath = options.clientPath ?? '/@browsagent/client.js';

  return {
    name: 'browsagent:stamp',
    enforce: 'pre',

    transform(code, id) {
      const clean = id.split('?')[0] ?? id;
      if (!/\.[jt]sx$/.test(clean)) return null;
      if (clean.includes('node_modules') && !options.includeDependencies) {
        return null;
      }

      const result = transformSync(code, {
        filename: clean,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[jsxStamp, { root }]],
      });

      if (!result?.code) return null;
      return { code: result.code, map: result.map ?? null };
    },

    transformIndexHtml(html) {
      const tag = `<script type="module" src="${clientPath}"></script>`;
      if (html.includes(clientPath)) return html;
      return html.replace('</body>', `${tag}\n</body>`);
    },
  };
}

/**
 * Find the source position of one file.
 * The value is relative to the project root.
 */
export function relativeSource(root: string, file: string, line: number, column: number): string {
  const rel = path.relative(root, file);
  return `${rel}:${line}:${column}`;
}
