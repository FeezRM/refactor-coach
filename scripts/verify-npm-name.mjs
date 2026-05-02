#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const packageName = 'refactor-coach';

const result = spawnSync('npm', ['view', packageName, 'name', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status === 0 && result.stdout.trim()) {
  console.error(
    `Package name "${packageName}" is already visible on npm. Verify ownership before publishing.`,
  );
  process.exit(1);
}

if (result.status !== 0 && !/E404|404 Not Found/i.test(result.stderr)) {
  console.error(`Could not verify npm package name availability for "${packageName}".`);
  console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

console.log(`Package name "${packageName}" is available or not currently published.`);
