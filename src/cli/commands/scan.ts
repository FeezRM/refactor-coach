import path from 'node:path';
import type { Command } from 'commander';
import { enhanceScanWithAi } from '../../ai/aiSummarizer.js';
import { loadConfig, type CliConfigOverrides } from '../../config/configLoader.js';
import type { AiConfig, PriorityLevel } from '../../core/types.js';
import { scanRepository } from '../../core/scanner.js';
import { writeScanOutputs } from '../../output/promptWriter.js';
import { Logger } from '../../utils/logger.js';

type ScanOptions = {
  path?: string;
  format?: string;
  noAi?: boolean;
  provider?: string;
  model?: string;
  limit?: string;
  minPriority?: string;
};

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan the current repository and generate refactor reports.')
    .option('--path <path>', 'Path inside the repo to scan.')
    .option('--format <format>', 'Output format: markdown or json.')
    .option('--no-ai', 'Disable optional AI explanations.')
    .option('--provider <provider>', 'AI provider: openai, anthropic, or ollama.')
    .option('--model <model>', 'Model name for optional AI explanations.')
    .option('--limit <n>', 'Maximum report/task/prompt opportunities to generate.')
    .option('--min-priority <priority>', 'Minimum generated output priority: high, medium, or low.')
    .action(async (options: ScanOptions) => {
      const rootPath = process.cwd();
      const logger = new Logger();
      const overrides = normalizeScanOptions(options);
      const config = loadConfig(rootPath, overrides);

      logger.info(`Scanning ${options.path ? path.resolve(rootPath, options.path) : rootPath}...`);
      const scanResult = await scanRepository(rootPath, config);
      await enhanceScanWithAi(scanResult, config, logger);
      const outputPaths = writeScanOutputs(rootPath, config, scanResult);

      logger.info('');
      logger.info(
        `AI Refactor Coach found ${scanResult.opportunities.length} refactor opportunities.`,
      );

      const top = scanResult.opportunities[0];
      if (top) {
        logger.info('');
        logger.info('Top recommendation:');
        logger.info(`${top.id}. ${top.title}`);
        logger.info(`   File: ${top.files.join(', ')}`);
        logger.info(
          `   Impact: ${top.impact}/10  Risk: ${top.risk}/10  Confidence: ${top.confidence}/10`,
        );
      }

      if (outputPaths.reportPath) {
        logger.info(`\nReport written to ${path.relative(rootPath, outputPaths.reportPath)}`);
      }
      if (outputPaths.scanJsonPath) {
        logger.info(`Scan data written to ${path.relative(rootPath, outputPaths.scanJsonPath)}`);
      }
      logger.info(
        `Generated prompts: ${outputPaths.promptPaths.length} of ${scanResult.opportunities.length} opportunities`,
      );
      logger.info(
        `AI prompts written to ${path.relative(rootPath, path.join(outputPaths.outputDirectory, 'prompts'))}`,
      );
    });
}

function normalizeScanOptions(options: ScanOptions): CliConfigOverrides {
  const overrides: CliConfigOverrides = {
    path: options.path,
    noAi: options.noAi,
    model: options.model,
  };

  if (options.limit !== undefined) {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error('--limit must be a non-negative integer.');
    }
    overrides.limit = limit;
  }

  if (options.minPriority) {
    if (!isPriorityLevel(options.minPriority)) {
      throw new Error('--min-priority must be high, medium, or low.');
    }
    overrides.minPriority = options.minPriority;
  }

  if (options.format) {
    if (options.format !== 'markdown' && options.format !== 'json') {
      throw new Error('--format must be either markdown or json.');
    }
    overrides.format = options.format;
  }

  if (options.provider) {
    if (!isProvider(options.provider)) {
      throw new Error('--provider must be openai, anthropic, or ollama.');
    }
    overrides.provider = options.provider;
  }

  return overrides;
}

function isProvider(value: string): value is AiConfig['provider'] {
  return value === 'openai' || value === 'anthropic' || value === 'ollama';
}

function isPriorityLevel(value: string): value is PriorityLevel {
  return value === 'high' || value === 'medium' || value === 'low';
}
