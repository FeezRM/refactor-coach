import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PriorityLevel, RefactorCoachConfig, RefactorOpportunity, ScanResult } from '../core/types.js';
import { buildAgentPrompt } from '../ai/promptBuilder.js';
import { ensureMarkdownFileName, toPosixPath } from '../utils/pathUtils.js';
import { renderMarkdownReport } from './markdownReport.js';
import { writeJsonReport } from './jsonReport.js';
import { opportunityTypeLabels } from '../opportunities/opportunityTypes.js';

export type OutputPaths = {
  outputDirectory: string;
  reportPath?: string;
  tasksPath?: string;
  scanJsonPath?: string;
  promptPaths: string[];
};

export type OutputSettings = {
  limit: number;
  minPriority: PriorityLevel;
};

export function writeScanOutputs(
  rootPath: string,
  config: RefactorCoachConfig,
  scanResult: ScanResult,
): OutputPaths {
  const outputDirectory = path.resolve(rootPath, config.output.directory);
  const promptDirectory = path.join(outputDirectory, 'prompts');
  rmSync(promptDirectory, { recursive: true, force: true });
  mkdirSync(promptDirectory, { recursive: true });
  writeOutputSettings(outputDirectory, config);

  const outputScanResult = createOutputScanResult(scanResult, config);
  const promptPaths = writePromptFiles(promptDirectory, outputScanResult);
  const outputPaths: OutputPaths = {
    outputDirectory,
    promptPaths,
  };

  if (config.output.format.includes('markdown')) {
    const reportPath = path.join(outputDirectory, 'report.md');
    const tasksPath = writeTasksFile(outputDirectory, outputScanResult);
    writeFileSync(reportPath, renderMarkdownReport(outputScanResult), 'utf8');
    outputPaths.reportPath = reportPath;
    outputPaths.tasksPath = tasksPath;
  }

  if (config.output.format.includes('json')) {
    outputPaths.scanJsonPath = writeJsonReport(outputDirectory, scanResult);
  }

  return outputPaths;
}

export function createOutputScanResult(
  scanResult: ScanResult,
  config: RefactorCoachConfig,
): ScanResult {
  const opportunities = scanResult.opportunities
    .filter((opportunity) => meetsMinPriority(opportunity, config.output.minPriority))
    .slice(0, config.output.limit)
    .map((opportunity) => withPromptPath(opportunity));

  return {
    ...scanResult,
    opportunities,
    summary: {
      ...scanResult.summary,
    },
  };
}

function meetsMinPriority(opportunity: RefactorOpportunity, minPriority: PriorityLevel): boolean {
  const rank: Record<RefactorOpportunity['priorityLabel'], number> = {
    High: 3,
    Medium: 2,
    Low: 1,
  };
  const minRank: Record<PriorityLevel, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return rank[opportunity.priorityLabel] >= minRank[minPriority];
}

export function createOutputSettings(config: RefactorCoachConfig): OutputSettings {
  return {
    limit: config.output.limit,
    minPriority: config.output.minPriority,
  };
}

export function writeOutputSettings(
  outputDirectory: string,
  config: RefactorCoachConfig,
): string {
  const dataDirectory = path.join(outputDirectory, 'data');
  mkdirSync(dataDirectory, { recursive: true });

  const outputPath = path.join(dataDirectory, 'output-settings.json');
  writeFileSync(outputPath, `${JSON.stringify(createOutputSettings(config), null, 2)}\n`, 'utf8');
  return outputPath;
}

export function readOutputSettings(
  outputDirectory: string,
  config: RefactorCoachConfig,
): OutputSettings {
  const outputPath = path.join(outputDirectory, 'data', 'output-settings.json');
  if (!existsSync(outputPath)) {
    return createOutputSettings(config);
  }

  const parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as Partial<OutputSettings>;
  const fallback = createOutputSettings(config);
  const parsedLimit = parsed.limit;

  return {
    limit:
      typeof parsedLimit === 'number' && Number.isInteger(parsedLimit) && parsedLimit >= 0
        ? parsedLimit
        : fallback.limit,
    minPriority: isPriorityLevel(parsed.minPriority) ? parsed.minPriority : fallback.minPriority,
  };
}

export function createOutputScanResultForLatestTasks(
  outputDirectory: string,
  config: RefactorCoachConfig,
  scanResult: ScanResult,
): ScanResult {
  const outputSettings = readOutputSettings(outputDirectory, config);
  return createOutputScanResult(scanResult, {
    ...config,
    output: {
      ...config.output,
      ...outputSettings,
    },
  });
}

export function writePromptForOpportunity(
  outputDirectory: string,
  scanResult: ScanResult,
  opportunityId: string,
): string {
  const opportunity =
    scanResult.opportunities.find((candidate) => candidate.id === opportunityId) ??
    scanResult.opportunities[Number(opportunityId) - 1];

  if (!opportunity) {
    throw new Error(`No opportunity found for id ${opportunityId}.`);
  }

  const promptDirectory = path.join(outputDirectory, 'prompts');
  mkdirSync(promptDirectory, { recursive: true });
  const fileName = ensureMarkdownFileName(Number(opportunity.id), opportunity.title);
  const promptPath = path.join(promptDirectory, fileName);
  opportunity.aiPromptPath = toPosixPath(path.relative(outputDirectory, promptPath));
  writeFileSync(promptPath, buildAgentPrompt(opportunity, scanResult), 'utf8');
  return promptPath;
}

function writePromptFiles(promptDirectory: string, scanResult: ScanResult): string[] {
  return scanResult.opportunities.map((opportunity) => {
    const fileName = ensureMarkdownFileName(Number(opportunity.id), opportunity.title);
    const promptPath = path.join(promptDirectory, fileName);
    const outputDirectory = path.dirname(promptDirectory);
    opportunity.aiPromptPath = toPosixPath(path.relative(outputDirectory, promptPath));
    writeFileSync(promptPath, buildAgentPrompt(opportunity, scanResult), 'utf8');
    return promptPath;
  });
}

export function writeTasksFile(outputDirectory: string, scanResult: ScanResult): string {
  mkdirSync(outputDirectory, { recursive: true });
  const tasksPath = path.join(outputDirectory, 'refactor_tasks.md');
  writeFileSync(tasksPath, renderTasks(scanResult), 'utf8');
  return tasksPath;
}

function withPromptPath(opportunity: RefactorOpportunity): RefactorOpportunity {
  const fileName = ensureMarkdownFileName(Number(opportunity.id), opportunity.title);
  return {
    ...opportunity,
    aiPromptPath: toPosixPath(path.join('prompts', fileName)),
  };
}

function isPriorityLevel(value: unknown): value is PriorityLevel {
  return value === 'high' || value === 'medium' || value === 'low';
}

export function renderTasks(scanResult: ScanResult): string {
  const tasks = scanResult.opportunities.map((opportunity) => {
    return `## ${opportunity.id}. ${opportunity.title}

- Type: ${opportunityTypeLabels[opportunity.type]}
- Priority: ${opportunity.priorityLabel} (${opportunity.priority})
- Files: ${opportunity.files.map((file) => `\`${file}\``).join(', ')}
- First step: ${opportunity.suggestedSteps[0] ?? 'Inspect the file and confirm the opportunity.'}
- Test first: ${opportunity.testsToAdd[0] ?? 'Run existing tests before changing code.'}
- Prompt: ${opportunity.aiPromptPath ? `\`${opportunity.aiPromptPath}\`` : 'Not generated'}
`;
  });

  return `# Refactor Tasks

Each task is intended to be small enough for a coding agent to complete safely.

${tasks.length > 0 ? tasks.join('\n') : 'No refactor tasks found with the current thresholds.'}
`;
}
