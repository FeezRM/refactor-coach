import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { checkRun, readRunBaseline, renderCheckResult } from '../../core/runManager.js';
import { getOutputDirectory } from '../../core/scanStore.js';

type CheckOptions = {
  run?: string;
  runCommands?: boolean;
  command?: string[];
};

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Verify a tracked refactor run after an agent edits files.')
    .option('--run <id>', 'Run id, or latest.', 'latest')
    .option('--no-run-commands', 'Skip configured check commands.')
    .option(
      '--command <command>',
      'Command to run instead of detected commands.',
      collectCommands,
      [],
    )
    .action(async (options: CheckOptions) => {
      const rootPath = process.cwd();
      const config = loadConfig(rootPath, { noAi: true });
      const outputDirectory = getOutputDirectory(rootPath, config.output.directory);
      const baseline = readRunBaseline(outputDirectory, options.run ?? 'latest');
      const commands =
        options.command && options.command.length > 0 ? options.command : baseline.checkCommands;
      const result = await checkRun(rootPath, outputDirectory, config, options.run ?? 'latest', {
        runCommands: options.runCommands !== false,
        commands,
      });

      console.log(renderCheckResult(result));
    });
}

function collectCommands(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
