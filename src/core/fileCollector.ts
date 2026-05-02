import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignorePackage from 'ignore';
import type { RefactorCoachConfig } from './types.js';
import { toPosixPath } from '../utils/pathUtils.js';

export async function collectSourceFiles(
  rootPath: string,
  config: RefactorCoachConfig,
): Promise<string[]> {
  const createIgnore = ignorePackage as unknown as typeof import('ignore').default;
  const ignoreMatcher = createIgnore();
  const gitignorePath = path.join(rootPath, '.gitignore');

  if (existsSync(gitignorePath)) {
    ignoreMatcher.add(readFileSync(gitignorePath, 'utf8'));
  }

  ignoreMatcher.add(config.exclude);

  const files = await fg(config.include, {
    cwd: rootPath,
    absolute: true,
    onlyFiles: true,
    dot: false,
    unique: true,
    ignore: expandIgnoreGlobs(config.exclude),
  });

  return files
    .filter((file) => !ignoreMatcher.ignores(toPosixPath(path.relative(rootPath, file))))
    .sort((a, b) => a.localeCompare(b));
}

function expandIgnoreGlobs(entries: string[]): string[] {
  return entries.flatMap((entry) => {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.includes('*')) {
      return [normalized];
    }

    return [normalized, `${normalized}/**`, `**/${normalized}/**`];
  });
}
