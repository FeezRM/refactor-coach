import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { getOutputDirectory, readLatestScan } from '../../core/scanStore.js';
import {
  createOutputScanResultForLatestTasks,
  writeTasksFile,
} from '../../output/promptWriter.js';

export function registerTasksCommand(program: Command): void {
  program
    .command('tasks')
    .description('Regenerate the small refactor task list from the latest scan.')
    .action(() => {
      const rootPath = process.cwd();
      const config = loadConfig(rootPath, { noAi: true });
      const outputDirectory = getOutputDirectory(rootPath, config.output.directory);
      const scanResult = readLatestScan(outputDirectory);
      const outputScanResult = createOutputScanResultForLatestTasks(
        outputDirectory,
        config,
        scanResult,
      );
      const tasksPath = writeTasksFile(outputDirectory, outputScanResult);
      console.log(`Tasks written to ${path.relative(rootPath, tasksPath)}`);
    });
}
