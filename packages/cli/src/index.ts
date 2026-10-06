#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { DEFAULT_PORT } from '@browsagent/shared';
import { IndexService } from '@browsagent/index-service';

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function start(): Promise<void> {
  const port = Number(process.env['BROWSAGENT_PORT'] ?? DEFAULT_PORT);
  const project = process.env['BROWSAGENT_PROJECT'] ?? process.cwd().split('/').pop() ?? 'project';

  const service = new IndexService({
    port,
    project,
    commit: currentCommit(),
  });

  const bound = await service.listen();
  console.info(`[browsagent] index service on port ${bound}`);
  console.info(`[browsagent] project ${project}`);
  console.info('[browsagent] add @browsagent/vite-plugin to the project config');
}

void start();
