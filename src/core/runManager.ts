import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  FileAnalysis,
  RefactorCoachConfig,
  RefactorOpportunity,
  ScanResult,
} from './types.js';
import { buildAgentPrompt } from '../ai/promptBuilder.js';
import { scanRepository } from './scanner.js';
import { findOpportunity } from './scanStore.js';
import { relativeToRoot, toPosixPath } from '../utils/pathUtils.js';

export type RunStatus = 'started' | 'checked' | 'completed';
export type CheckRecommendation = 'pass' | 'warn' | 'fail';

export type GitSnapshot = {
  available: boolean;
  isRepo: boolean;
  dirty: boolean;
  changedFiles: string[];
  raw: string;
  reason?: string;
};

export type BaselineTargetFile = {
  path: string;
  hash: string;
  lineCount: number;
  complexityScore: number;
  signalCount: number;
};

export type RefactorRunBaseline = {
  version: 1;
  runId: string;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  rootPath: string;
  outputDirectory: string;
  runDirectory: string;
  taskPath: string;
  baselineFilesDirectory: string;
  opportunity: RefactorOpportunity;
  targetFiles: BaselineTargetFile[];
  git: GitSnapshot;
  checkCommands: string[];
  lastCheck?: RefactorRunCheckResult;
  completionSummary?: string;
};

export type TargetComparison = {
  path: string;
  existedAtBaseline: boolean;
  existsNow: boolean;
  changed: boolean;
  lineCountBefore: number;
  lineCountAfter?: number;
  lineDelta?: number;
  complexityBefore: number;
  complexityAfter?: number;
  complexityDelta?: number;
  signalCountBefore: number;
  signalCountAfter?: number;
  signalDelta?: number;
  materiallyWorse: boolean;
};

export type CheckCommandResult = {
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type RefactorRunCheckResult = {
  runId: string;
  checkedAt: string;
  recommendation: CheckRecommendation;
  targetComparisons: TargetComparison[];
  changedFilesInsideScope: string[];
  changedFilesOutsideScope: string[];
  git: GitSnapshot;
  commandResults: CheckCommandResult[];
  warnings: string[];
  failures: string[];
};

export type BeginRunOptions = {
  maxFiles?: number;
};

export type CheckRunOptions = {
  runCommands: boolean;
  commands: string[];
};

export type CompleteRunResult = {
  baseline: RefactorRunBaseline;
  summaryPath: string;
};

export function getRunsDirectory(outputDirectory: string): string {
  return path.join(outputDirectory, 'runs');
}

export function getNextUnstartedOpportunity(
  outputDirectory: string,
  scanResult: ScanResult,
): RefactorOpportunity | undefined {
  const startedKeys = new Set(
    readRunBaselines(outputDirectory).map((baseline) => opportunityKey(baseline.opportunity)),
  );

  return scanResult.opportunities.find(
    (opportunity) => !startedKeys.has(opportunityKey(opportunity)),
  );
}

export function beginRun(
  rootPath: string,
  outputDirectory: string,
  config: RefactorCoachConfig,
  scanResult: ScanResult,
  opportunityId: string,
  options: BeginRunOptions = {},
): RefactorRunBaseline {
  const opportunity = findOpportunity(scanResult, opportunityId);
  const maxFiles = options.maxFiles ?? config.agent.maxFilesPerTask;
  if (opportunity.files.length > maxFiles) {
    throw new Error(
      `Opportunity ${opportunity.id} touches ${opportunity.files.length} files, which exceeds --max-files ${maxFiles}.`,
    );
  }

  const git = getGitSnapshot(rootPath);
  if (!config.agent.allowDirty && git.isRepo && git.dirty) {
    throw new Error(
      'Repository has uncommitted changes. Commit/stash first or enable agent.allowDirty.',
    );
  }

  const runId = createRunId();
  const runDirectory = path.join(getRunsDirectory(outputDirectory), runId);
  const baselineFilesDirectory = path.join(runDirectory, 'baseline-files');
  mkdirSync(baselineFilesDirectory, { recursive: true });

  const taskPath = path.join(runDirectory, 'task.md');
  writeFileSync(taskPath, buildAgentPrompt(opportunity, scanResult), 'utf8');

  const targetFiles = opportunity.files.map((filePath) =>
    snapshotTargetFile(rootPath, baselineFilesDirectory, scanResult.files, filePath),
  );

  const baseline: RefactorRunBaseline = {
    version: 1,
    runId,
    status: 'started',
    createdAt: new Date().toISOString(),
    rootPath,
    outputDirectory,
    runDirectory,
    taskPath,
    baselineFilesDirectory,
    opportunity,
    targetFiles,
    git,
    checkCommands: detectCheckCommands(rootPath, config, scanResult, opportunity),
  };

  writeBaseline(baseline);
  return baseline;
}

export async function checkRun(
  rootPath: string,
  outputDirectory: string,
  config: RefactorCoachConfig,
  runIdOrLatest: string,
  options: CheckRunOptions,
): Promise<RefactorRunCheckResult> {
  const baseline = readRunBaseline(outputDirectory, runIdOrLatest);
  const currentScan = await scanRepository(rootPath, config);
  const git = getGitSnapshot(rootPath);
  const targetComparisons = baseline.targetFiles.map((targetFile) =>
    compareTargetFile(rootPath, currentScan.files, targetFile),
  );
  const scope = new Set(baseline.opportunity.files);
  const toolStateDirectory = toPosixPath(path.relative(rootPath, outputDirectory));
  const gitChangedFiles = git.changedFiles.filter(
    (file) => !file.startsWith(`${toolStateDirectory}/`) && file !== toolStateDirectory,
  );
  const changedFilesInsideScope = git.isRepo
    ? gitChangedFiles.filter((file) => scope.has(file))
    : targetComparisons
        .filter((comparison) => comparison.changed)
        .map((comparison) => comparison.path);
  const changedFilesOutsideScope = git.isRepo
    ? gitChangedFiles.filter((file) => !scope.has(file))
    : [];
  const commandsToRun = options.runCommands ? options.commands : [];
  const commandResults = commandsToRun.map((command) => runCheckCommand(rootPath, command));
  const failures = buildFailures(targetComparisons, commandResults);
  const warnings = buildWarnings({
    git,
    commandResults,
    commandsToRun,
    changedFilesOutsideScope,
    targetComparisons,
  });
  const recommendation: CheckRecommendation =
    failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
  const result: RefactorRunCheckResult = {
    runId: baseline.runId,
    checkedAt: new Date().toISOString(),
    recommendation,
    targetComparisons,
    changedFilesInsideScope,
    changedFilesOutsideScope,
    git,
    commandResults,
    warnings,
    failures,
  };

  baseline.status = 'checked';
  baseline.lastCheck = result;
  writeBaseline(baseline);
  writeFileSync(
    path.join(baseline.runDirectory, 'check.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(baseline.runDirectory, 'check.md'), renderCheckResult(result), 'utf8');

  return result;
}

export function completeRun(
  outputDirectory: string,
  runIdOrLatest: string,
  summary?: string,
): CompleteRunResult {
  const baseline = readRunBaseline(outputDirectory, runIdOrLatest);
  const finalSummary =
    summary ??
    (baseline.lastCheck
      ? `Completed with check recommendation: ${baseline.lastCheck.recommendation}.`
      : 'Completed without a recorded check result.');

  baseline.status = 'completed';
  baseline.completedAt = new Date().toISOString();
  baseline.completionSummary = finalSummary;
  writeBaseline(baseline);

  const summaryPath = path.join(baseline.runDirectory, 'result.md');
  if (!existsSync(summaryPath)) {
    writeFileSync(summaryPath, '# Refactor Run Result\n', 'utf8');
  }

  appendFileSync(
    summaryPath,
    `
## ${baseline.completedAt}

- Run: ${baseline.runId}
- Opportunity: ${baseline.opportunity.id}. ${baseline.opportunity.title}
- Status: completed
- Summary: ${finalSummary}
`,
    'utf8',
  );

  return { baseline, summaryPath };
}

export function readRunBaseline(
  outputDirectory: string,
  runIdOrLatest: string,
): RefactorRunBaseline {
  const runId = runIdOrLatest === 'latest' ? resolveLatestRunId(outputDirectory) : runIdOrLatest;
  const baselinePath = path.join(getRunsDirectory(outputDirectory), runId, 'baseline.json');
  if (!existsSync(baselinePath)) {
    throw new Error(`No refactor run found for ${runIdOrLatest}.`);
  }

  return JSON.parse(readFileSync(baselinePath, 'utf8')) as RefactorRunBaseline;
}

export function readRunBaselines(outputDirectory: string): RefactorRunBaseline[] {
  const runsDirectory = getRunsDirectory(outputDirectory);
  if (!existsSync(runsDirectory)) {
    return [];
  }

  return readdirSync(runsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDirectory, entry.name, 'baseline.json'))
    .filter((baselinePath) => existsSync(baselinePath))
    .map((baselinePath) => JSON.parse(readFileSync(baselinePath, 'utf8')) as RefactorRunBaseline);
}

export function renderOpportunityMarkdown(opportunity: RefactorOpportunity): string {
  return `# Next Refactor Opportunity

## ${opportunity.id}. ${opportunity.title}

- Files: ${opportunity.files.map((file) => `\`${file}\``).join(', ')}
- Priority: ${opportunity.priorityLabel} (${opportunity.priority})
- Impact: ${opportunity.impact}/10
- Risk: ${opportunity.risk}/10
- Confidence: ${opportunity.confidence}/10

${opportunity.explanation}

Run \`refactor-coach begin ${opportunity.id}\` to create a tracked refactor run.
`;
}

export function renderBeginMarkdown(baseline: RefactorRunBaseline): string {
  return `# Refactor Run Started

- Run: ${baseline.runId}
- Opportunity: ${baseline.opportunity.id}. ${baseline.opportunity.title}
- Files: ${baseline.opportunity.files.map((file) => `\`${file}\``).join(', ')}
- Task: \`${toPosixPath(relativeToRoot(baseline.rootPath, baseline.taskPath))}\`
- Baseline: \`${toPosixPath(relativeToRoot(baseline.rootPath, path.join(baseline.runDirectory, 'baseline.json')))}\`
- Checks: ${baseline.checkCommands.length > 0 ? baseline.checkCommands.map((command) => `\`${command}\``).join(', ') : 'none detected'}
- Git status: ${baseline.git.isRepo ? (baseline.git.dirty ? 'dirty' : 'clean') : 'unavailable'}

The tool did not edit source files. Give the task file to the coding agent, then run \`refactor-coach check --run ${baseline.runId}\`.
`;
}

export function renderCheckResult(result: RefactorRunCheckResult): string {
  return `# Refactor Run Check

- Run: ${result.runId}
- Recommendation: ${result.recommendation}
- Checked at: ${result.checkedAt}

## Target Files

${result.targetComparisons.map(renderTargetComparison).join('\n')}

## Changed Files

- Inside scope: ${result.changedFilesInsideScope.length > 0 ? result.changedFilesInsideScope.map((file) => `\`${file}\``).join(', ') : 'none detected'}
- Outside scope: ${result.changedFilesOutsideScope.length > 0 ? result.changedFilesOutsideScope.map((file) => `\`${file}\``).join(', ') : 'none detected'}

## Commands

${result.commandResults.length > 0 ? result.commandResults.map(renderCommandResult).join('\n') : 'No commands were run.'}

## Warnings

${result.warnings.length > 0 ? result.warnings.map((warning) => `- ${warning}`).join('\n') : '- None'}

## Failures

${result.failures.length > 0 ? result.failures.map((failure) => `- ${failure}`).join('\n') : '- None'}
`;
}

function snapshotTargetFile(
  rootPath: string,
  baselineFilesDirectory: string,
  files: FileAnalysis[],
  filePath: string,
): BaselineTargetFile {
  const absolutePath = resolveRepoFile(rootPath, filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Target file does not exist: ${filePath}`);
  }

  const targetCopyPath = path.join(baselineFilesDirectory, filePath);
  mkdirSync(path.dirname(targetCopyPath), { recursive: true });
  copyFileSync(absolutePath, targetCopyPath);

  const analysis = files.find((file) => file.path === filePath);
  return {
    path: filePath,
    hash: hashFile(absolutePath),
    lineCount: analysis?.lineCount ?? countLines(readFileSync(absolutePath, 'utf8')),
    complexityScore: analysis?.complexityScore ?? 0,
    signalCount: analysis?.signals.length ?? 0,
  };
}

function compareTargetFile(
  rootPath: string,
  files: FileAnalysis[],
  baseline: BaselineTargetFile,
): TargetComparison {
  const absolutePath = resolveRepoFile(rootPath, baseline.path);
  const existsNow = existsSync(absolutePath);
  const currentAnalysis = files.find((file) => file.path === baseline.path);

  if (!existsNow) {
    return {
      path: baseline.path,
      existedAtBaseline: true,
      existsNow,
      changed: true,
      lineCountBefore: baseline.lineCount,
      complexityBefore: baseline.complexityScore,
      signalCountBefore: baseline.signalCount,
      materiallyWorse: false,
    };
  }

  const lineCountAfter =
    currentAnalysis?.lineCount ?? countLines(readFileSync(absolutePath, 'utf8'));
  const complexityAfter = currentAnalysis?.complexityScore ?? baseline.complexityScore;
  const signalCountAfter = currentAnalysis?.signals.length ?? baseline.signalCount;
  const lineDelta = lineCountAfter - baseline.lineCount;
  const complexityDelta = complexityAfter - baseline.complexityScore;
  const signalDelta = signalCountAfter - baseline.signalCount;

  return {
    path: baseline.path,
    existedAtBaseline: true,
    existsNow,
    changed: hashFile(absolutePath) !== baseline.hash,
    lineCountBefore: baseline.lineCount,
    lineCountAfter,
    lineDelta,
    complexityBefore: baseline.complexityScore,
    complexityAfter,
    complexityDelta,
    signalCountBefore: baseline.signalCount,
    signalCountAfter,
    signalDelta,
    materiallyWorse:
      lineDelta > Math.max(20, Math.ceil(baseline.lineCount * 0.1)) || complexityDelta > 2,
  };
}

function detectCheckCommands(
  rootPath: string,
  config: RefactorCoachConfig,
  scanResult: ScanResult,
  opportunity: RefactorOpportunity,
): string[] {
  const configured = config.checks.commands.map((command) => command.trim()).filter(Boolean);
  if (!config.checks.autoDetect) {
    return configured;
  }

  const packageJsonPath = path.join(rootPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return configured;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const packageManager = scanResult.project.packageManager ?? 'npm';
  const detected = ['typecheck', 'test', 'lint', 'build']
    .filter((scriptName) => scriptName in scripts)
    .map((scriptName) => commandForScript(packageManager, scriptName));
  const workspaceCommands = detectWorkspaceCheckCommands(rootPath, scanResult, opportunity);

  return Array.from(new Set([...configured, ...workspaceCommands, ...detected]));
}

function detectWorkspaceCheckCommands(
  rootPath: string,
  scanResult: ScanResult,
  opportunity: RefactorOpportunity,
): string[] {
  const workspaces = opportunity.files
    .map((filePath) => scanResult.files.find((file) => file.path === filePath)?.workspace)
    .filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace));
  const uniqueWorkspaces = Array.from(
    new Map(workspaces.map((workspace) => [workspace.rootPath, workspace])).values(),
  );

  return uniqueWorkspaces.flatMap((workspace) => {
    const packageJsonPath = path.join(rootPath, workspace.rootPath, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return [];
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const workspaceTarget = packageJson.name
      ? `--workspace ${packageJson.name}`
      : `--workspace ${workspace.rootPath}`;

    return ['typecheck', 'test', 'lint', 'build']
      .filter((scriptName) => scriptName in scripts)
      .map((scriptName) => `npm ${workspaceTarget} run ${scriptName}`);
  });
}

function commandForScript(packageManager: string, scriptName: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm ${scriptName}`;
    case 'yarn':
      return `yarn ${scriptName}`;
    case 'bun':
      return `bun run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

function getGitSnapshot(rootPath: string): GitSnapshot {
  const insideRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: rootPath,
    encoding: 'utf8',
  });

  if (insideRepo.error) {
    return {
      available: false,
      isRepo: false,
      dirty: false,
      changedFiles: [],
      raw: '',
      reason: insideRepo.error.message,
    };
  }

  if (insideRepo.status !== 0) {
    return {
      available: true,
      isRepo: false,
      dirty: false,
      changedFiles: [],
      raw: insideRepo.stderr.trim(),
      reason: 'not a git repository',
    };
  }

  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: rootPath,
    encoding: 'utf8',
  });
  const raw = status.stdout.trim();
  const changedFiles = raw
    ? raw
        .split(/\r?\n/)
        .map((line) => normalizeGitStatusPath(line.slice(3)))
        .filter(Boolean)
    : [];

  return {
    available: true,
    isRepo: true,
    dirty: changedFiles.length > 0,
    changedFiles,
    raw,
  };
}

function normalizeGitStatusPath(value: string): string {
  const filePath = value.includes(' -> ') ? (value.split(' -> ').at(-1) ?? value) : value;
  return filePath.replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function runCheckCommand(rootPath: string, command: string): CheckCommandResult {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: rootPath,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 1024 * 1024 * 10,
  });

  return {
    command,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    stdout: truncate(result.stdout ?? ''),
    stderr: truncate(result.stderr ?? result.error?.message ?? ''),
  };
}

function buildFailures(
  targetComparisons: TargetComparison[],
  commandResults: CheckCommandResult[],
): string[] {
  const failures: string[] = [];
  for (const comparison of targetComparisons) {
    if (!comparison.existsNow) {
      failures.push(`Target file was removed: ${comparison.path}`);
    }
  }

  for (const result of commandResults) {
    if (result.exitCode !== 0) {
      failures.push(`Command failed: ${result.command} (exit ${result.exitCode ?? 'unknown'})`);
    }
  }

  return failures;
}

function buildWarnings(input: {
  git: GitSnapshot;
  commandResults: CheckCommandResult[];
  commandsToRun: string[];
  changedFilesOutsideScope: string[];
  targetComparisons: TargetComparison[];
}): string[] {
  const warnings: string[] = [];

  if (!input.git.isRepo) {
    warnings.push(
      'Git is unavailable for this workspace, so unrelated changed files could not be inspected.',
    );
  }

  if (input.commandsToRun.length === 0) {
    warnings.push('No check commands were run.');
  }

  if (input.changedFilesOutsideScope.length > 0) {
    warnings.push(
      `Files outside the refactor scope changed: ${input.changedFilesOutsideScope.join(', ')}`,
    );
  }

  for (const comparison of input.targetComparisons) {
    if (comparison.materiallyWorse) {
      warnings.push(`Target file appears materially larger or more complex: ${comparison.path}`);
    }
  }

  return warnings;
}

function renderTargetComparison(comparison: TargetComparison): string {
  if (!comparison.existsNow) {
    return `- \`${comparison.path}\`: removed`;
  }

  return `- \`${comparison.path}\`: ${comparison.changed ? 'changed' : 'unchanged'}, lines ${comparison.lineCountBefore} -> ${comparison.lineCountAfter} (${formatDelta(comparison.lineDelta)}), complexity ${comparison.complexityBefore} -> ${comparison.complexityAfter} (${formatDelta(comparison.complexityDelta)}), signals ${comparison.signalCountBefore} -> ${comparison.signalCountAfter} (${formatDelta(comparison.signalDelta)})`;
}

function renderCommandResult(result: CheckCommandResult): string {
  return `- \`${result.command}\`: exit ${result.exitCode ?? 'unknown'} in ${result.durationMs}ms`;
}

function formatDelta(value?: number): string {
  if (value === undefined) return 'n/a';
  return value >= 0 ? `+${value}` : String(value);
}

function writeBaseline(baseline: RefactorRunBaseline): void {
  mkdirSync(baseline.runDirectory, { recursive: true });
  writeFileSync(
    path.join(baseline.runDirectory, 'baseline.json'),
    `${JSON.stringify(baseline, null, 2)}\n`,
    'utf8',
  );
}

function resolveLatestRunId(outputDirectory: string): string {
  const baselines = readRunBaselines(outputDirectory);
  if (baselines.length === 0) {
    throw new Error('No refactor runs found. Run `refactor-coach begin <id>` first.');
  }

  return baselines.slice().sort((a, b) => {
    const aTime = statSync(a.runDirectory).mtimeMs;
    const bTime = statSync(b.runDirectory).mtimeMs;
    return bTime - aTime || b.createdAt.localeCompare(a.createdAt);
  })[0].runId;
}

function createRunId(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}_${suffix}`;
}

function opportunityKey(opportunity: RefactorOpportunity): string {
  return `${opportunity.type}:${opportunity.title}:${opportunity.files.slice().sort().join('|')}`;
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function resolveRepoFile(rootPath: string, relativePath: string): string {
  const absolutePath = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }

  return absolutePath;
}

function countLines(content: string): number {
  return content.trim().length === 0 ? 0 : content.split(/\r?\n/).length;
}

function truncate(value: string): string {
  return value.length > 20_000 ? `${value.slice(0, 20_000)}\n[truncated]` : value;
}
