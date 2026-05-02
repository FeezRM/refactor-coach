#!/usr/bin/env node
import { Command } from 'commander';
import { registerBeginCommand } from './commands/begin.js';
import { registerCheckCommand } from './commands/check.js';
import { registerCompleteCommand } from './commands/complete.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerNextCommand } from './commands/next.js';
import { registerPromptCommand } from './commands/prompt.js';
import { registerScanCommand } from './commands/scan.js';
import { registerTasksCommand } from './commands/tasks.js';
import { getPackageVersion } from '../utils/packageInfo.js';

const program = new Command();

program
  .name('refactor-coach')
  .description('Find messy code and turn it into safe, AI-ready refactor plans.')
  .version(getPackageVersion());

registerScanCommand(program);
registerNextCommand(program);
registerBeginCommand(program);
registerCheckCommand(program);
registerCompleteCommand(program);
registerExplainCommand(program);
registerPromptCommand(program);
registerTasksCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
