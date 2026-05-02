import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultConfig } from './defaultConfig.js';
import type { PriorityLevel, RefactorCoachConfig } from '../core/types.js';

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Array<unknown>
    ? T[K]
    : T[K] extends Record<string, unknown>
      ? PartialDeep<T[K]>
      : T[K];
};

export type CliConfigOverrides = {
  path?: string;
  format?: 'markdown' | 'json';
  noAi?: boolean;
  provider?: RefactorCoachConfig['ai']['provider'];
  model?: string;
  limit?: number;
  minPriority?: PriorityLevel;
};

export function loadConfig(
  rootPath: string,
  overrides: CliConfigOverrides = {},
): RefactorCoachConfig {
  const configPath = path.join(rootPath, '.refactorcoachrc.json');
  const userConfig = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, 'utf8')) as PartialDeep<RefactorCoachConfig>)
    : {};

  const merged: RefactorCoachConfig = {
    ...defaultConfig,
    ...userConfig,
    thresholds: {
      ...defaultConfig.thresholds,
      ...userConfig.thresholds,
    },
    ai: {
      ...defaultConfig.ai,
      ...userConfig.ai,
    },
    output: {
      ...defaultConfig.output,
      ...userConfig.output,
    },
    agent: {
      ...defaultConfig.agent,
      ...userConfig.agent,
    },
    checks: {
      ...defaultConfig.checks,
      ...userConfig.checks,
    },
  };

  if (overrides.path) {
    const normalized = normalizeGlobBase(overrides.path);
    merged.include = [`${normalized}/**/*.{ts,tsx,js,jsx,py,java}`];
  }

  if (overrides.format) {
    merged.output.format = [overrides.format];
  }

  if (overrides.noAi) {
    merged.ai.enabled = false;
  }

  if (overrides.provider) {
    merged.ai.provider = overrides.provider;
    merged.ai.enabled = !overrides.noAi;
  }

  if (overrides.model) {
    merged.ai.model = overrides.model;
    merged.ai.enabled = !overrides.noAi;
  }

  if (overrides.limit !== undefined) {
    merged.output.limit = overrides.limit;
  }

  if (overrides.minPriority) {
    merged.output.minPriority = overrides.minPriority;
  }

  return merged;
}

function normalizeGlobBase(inputPath: string): string {
  const withoutTrailingSlash = inputPath.replace(/[/\\]+$/, '');
  return withoutTrailingSlash === '.' ? '**' : withoutTrailingSlash.replace(/\\/g, '/');
}
