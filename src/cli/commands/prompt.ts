import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { getOutputDirectory, readLatestScan } from '../../core/scanStore.js';
import { writePromptForOpportunity } from '../../output/promptWriter.js';

export function registerPromptCommand(program: Command): void {
  program
    .command('prompt')
    .argument('<opportunityId>', 'Opportunity id from the latest scan.')
    .description('Generate an AI-ready prompt for a specific opportunity.')
    .action((opportunityId: string) => {
      const rootPath = process.cwd();
      const config = loadConfig(rootPath, { noAi: true });
      const outputDirectory = getOutputDirectory(rootPath, config.output.directory);
      const scanResult = readLatestScan(outputDirectory);
      const promptPath = writePromptForOpportunity(outputDirectory, scanResult, opportunityId);
      console.log(`Prompt written to ${path.relative(rootPath, promptPath)}`);
    });
}
