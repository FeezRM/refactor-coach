import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { beginRun, renderBeginMarkdown } from '../../core/runManager.js';
import { getOutputDirectory, readLatestScan } from '../../core/scanStore.js';

type BeginOptions = {
  format?: string;
  maxFiles?: string;
};

export function registerBeginCommand(program: Command): void {
  program
    .command('begin')
    .alias('apply')
    .argument('<opportunityId>', 'Opportunity id from the latest scan.')
    .description('Create a tracked refactor run without editing source files.')
    .option('--format <format>', 'Output format: markdown or json.', 'markdown')
    .option('--max-files <n>', 'Maximum target files allowed for this task.')
    .action((opportunityId: string, options: BeginOptions) => {
      const rootPath = process.cwd();
      const config = loadConfig(rootPath, { noAi: true });
      const outputDirectory = getOutputDirectory(rootPath, config.output.directory);
      const scanResult = readLatestScan(outputDirectory);
      const maxFiles = options.maxFiles ? Number.parseInt(options.maxFiles, 10) : undefined;

      if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles < 1)) {
        throw new Error('--max-files must be a positive integer.');
      }

      const baseline = beginRun(rootPath, outputDirectory, config, scanResult, opportunityId, {
        maxFiles,
      });

      if (options.format === 'json') {
        console.log(
          JSON.stringify(
            {
              runId: baseline.runId,
              runDirectory: path.relative(rootPath, baseline.runDirectory),
              taskPath: path.relative(rootPath, baseline.taskPath),
              baselinePath: path.relative(
                rootPath,
                path.join(baseline.runDirectory, 'baseline.json'),
              ),
              opportunity: baseline.opportunity,
              checkCommands: baseline.checkCommands,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (options.format !== 'markdown') {
        throw new Error('--format must be either markdown or json.');
      }

      console.log(renderBeginMarkdown(baseline));
    });
}
