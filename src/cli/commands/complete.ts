import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { completeRun } from '../../core/runManager.js';
import { getOutputDirectory } from '../../core/scanStore.js';

type CompleteOptions = {
  run?: string;
  summary?: string;
};

export function registerCompleteCommand(program: Command): void {
  program
    .command('complete')
    .description('Mark a tracked refactor run as completed.')
    .option('--run <id>', 'Run id, or latest.', 'latest')
    .option('--summary <text>', 'Completion summary to write into the run result.')
    .action((options: CompleteOptions) => {
      const rootPath = process.cwd();
      const config = loadConfig(rootPath, { noAi: true });
      const outputDirectory = getOutputDirectory(rootPath, config.output.directory);
      const result = completeRun(outputDirectory, options.run ?? 'latest', options.summary);

      console.log(
        `Completed run ${result.baseline.runId}. Result written to ${path.relative(rootPath, result.summaryPath)}`,
      );
    });
}
