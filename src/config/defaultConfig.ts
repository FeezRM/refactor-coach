import type { RefactorCoachConfig } from '../core/types.js';

export const defaultConfig: RefactorCoachConfig = {
  include: ['**/*.{ts,tsx,js,jsx,py,java}'],
  exclude: [
    'node_modules',
    'bower_components',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.git',
    '.refactor-coach',
    '**/*.d.ts',
    '**/*.min.js',
    '**/__pycache__',
    '**/*.class',
  ],
  thresholds: {
    largeFileLines: 300,
    largeComponentLines: 250,
    complexFunctionLines: 60,
    maxFunctionParams: 5,
    maxHooksInComponent: 8,
    complexFunctionComplexity: 12,
    maxResponsibilities: 4,
  },
  ai: {
    enabled: false,
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
  output: {
    directory: '.refactor-coach',
    format: ['markdown', 'json'],
    limit: 20,
    minPriority: 'medium',
  },
  agent: {
    allowDirty: true,
    maxFilesPerTask: 8,
  },
  checks: {
    commands: [],
    autoDetect: true,
  },
};
