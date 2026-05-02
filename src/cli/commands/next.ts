import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { getNextUnstartedOpportunity, renderOpportunityMarkdown } from '../../core/runManager.js';
import { getOutputDirectory, readLatestScan } from '../../core/scanStore.js';

type NextOptions = {
  format?: string;
};

export function registerNextCommand(program: Command): void {
  program
    .command('next')
    .description('Print the best unstarted opportunity from the latest scan.')
    .option('--format <format>', 'Output format: markdown or json.', 'markdown')
    .action((options: NextOptions) => {
      const rootPath = process.cwd();
      const config = loadConfig(rootPath, { noAi: true });
      const outputDirectory = getOutputDirectory(rootPath, config.output.directory);
      const scanResult = readLatestScan(outputDirectory);
      const opportunity = getNextUnstartedOpportunity(outputDirectory, scanResult);

      if (!opportunity) {
        const message = 'No unstarted opportunities found. Run `refactor-coach scan` to refresh.';
        if (options.format === 'json') {
          console.log(JSON.stringify({ opportunity: null, message }, null, 2));
          return;
        }

        console.log(message);
        return;
      }

      if (options.format === 'json') {
        console.log(
          JSON.stringify(
            {
              opportunity,
              beginCommand: `refactor-coach begin ${opportunity.id}`,
              outputDirectory: path.relative(rootPath, outputDirectory),
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

      console.log(renderOpportunityMarkdown(opportunity));
    });
}
