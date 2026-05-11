import path from 'node:path';
import type { FileAnalysis, RefactorOpportunity, ScanResult } from '../core/types.js';

export function buildAgentPrompt(opportunity: RefactorOpportunity, scanResult: ScanResult): string {
  const primaryFile = opportunity.files[0] ?? 'unknown file';
  const fileSummaries = opportunity.files
    .map((filePath) => scanResult.files.find((file) => file.path === filePath))
    .filter((file): file is FileAnalysis => Boolean(file));
  const possibleTestFiles = fileSummaries.map((file) => inferTestFile(file.path));
  const possibleNewFiles = inferLikelyNewFiles(opportunity);
  const suggestedHelper = getSuggestedHelper(opportunity);
  const contextLines = renderContext(fileSummaries, scanResult);

  return `# Refactor Task: ${opportunity.title}

## Goal

Refactor \`${primaryFile}\` to improve maintainability without changing behavior.

## Current Problem

${opportunity.explanation}

Evidence from the scan:
${renderEvidence(opportunity)}
${suggestedHelper ? `\nSuggested helper: \`${suggestedHelper}\`` : ''}

## Codebase Context

${contextLines}

## Required Changes

${opportunity.suggestedSteps.map((step) => `- ${step}`).join('\n')}

## Constraints

- Do not change user-facing behavior.
- Do not change public API names unless absolutely necessary.
- Keep existing tests passing.
- Add tests before refactoring if behavior is not currently covered.
- Prefer small, reviewable changes.
- Do not make unrelated formatting-only rewrites.

## Why This Task Is Bounded

Only work on the files listed below and the smallest extracted helper, hook, service, or test needed for this opportunity. Do not combine this task with nearby refactors from the report.

## Suggested Implementation Plan

1. Read the target file and identify its current responsibilities.
2. Add or update tests for current behavior before moving risky logic.
3. Extract the lowest-risk helper, hook, component, or service first.
4. Run tests and typecheck after the first extraction.
5. Continue extraction only if tests pass.
6. Summarize the final diff and any behavior intentionally left unchanged.

## Files Likely Involved

${[...opportunity.files, ...possibleTestFiles, ...possibleNewFiles]
  .filter(Boolean)
  .map((file) => `- \`${file}\``)
  .join('\n')}

## Tests To Add First

${opportunity.testsToAdd.map((test) => `- ${test}`).join('\n')}

## Acceptance Criteria

- Existing behavior is unchanged.
- Tests pass.
- Main file is shorter or easier to scan.
- Extracted modules have clear names and single responsibilities.
- No unrelated files are modified.
`;
}

export function buildAiPromptInput(
  opportunity: RefactorOpportunity,
  scanResult: ScanResult,
): string {
  const fileSummaries = scanResult.files
    .filter((file) => opportunity.files.includes(file.path))
    .map((file) => ({
      path: file.path,
      lineCount: file.lineCount,
      importCount: file.importCount,
      exportCount: file.exportCount,
      functionCount: file.functionCount,
      componentCount: file.componentCount,
      hookCount: file.hookCount,
      hasTestsNearby: file.hasTestsNearby,
      responsibilities: file.responsibilities,
      signals: file.signals.slice(0, 4).map(summarizeSignal),
      functions: file.functions
        .slice()
        .sort(
          (a, b) =>
            b.cyclomaticComplexity - a.cyclomaticComplexity ||
            b.lineCount - a.lineCount ||
            a.startLine - b.startLine,
        )
        .slice(0, 5)
        .map((fn) => ({
          name: fn.name,
          startLine: fn.startLine,
          lineCount: fn.lineCount,
          parameterCount: fn.parameterCount,
          cyclomaticComplexity: fn.cyclomaticComplexity,
          maxConditionalDepth: fn.maxConditionalDepth,
          returnsJsx: fn.returnsJsx,
        })),
    }));

  return JSON.stringify(
    {
      projectInfo: scanResult.project,
      opportunity: summarizeOpportunity(opportunity),
      fileSummaries,
      signals: opportunity.signals.slice(0, 4).map(summarizeSignal),
      relevantSnippets: [],
    },
    null,
    2,
  );
}

function summarizeOpportunity(opportunity: RefactorOpportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    type: opportunity.type,
    files: opportunity.files,
    impact: opportunity.impact,
    risk: opportunity.risk,
    confidence: opportunity.confidence,
    priorityLabel: opportunity.priorityLabel,
    explanation: opportunity.explanation,
    suggestedSteps: opportunity.suggestedSteps.slice(0, 3),
    testsToAdd: opportunity.testsToAdd.slice(0, 3),
    metadata: summarizeMetadata(opportunity.metadata),
  };
}

function summarizeSignal(signal: FileAnalysis['signals'][number]) {
  return {
    type: signal.type,
    message: signal.message,
    severity: signal.severity,
    location: signal.location,
    metadata: summarizeMetadata(signal.metadata),
  };
}

function summarizeMetadata(metadata: Record<string, unknown> | undefined):
  | Record<string, unknown>
  | undefined {
  if (!metadata) return undefined;

  const summarizedEntries = Object.entries(metadata)
    .slice(0, 8)
    .map(([key, value]) => [key, summarizeMetadataValue(value)] as const);
  return Object.fromEntries(summarizedEntries);
}

function summarizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 2).map((item) => summarizeMetadataValue(item));
  }

  if (value && typeof value === 'object') {
    return summarizeMetadata(value as Record<string, unknown>);
  }

  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }

  return value;
}

function renderEvidence(opportunity: RefactorOpportunity): string {
  if (opportunity.signals.length === 0) {
    return '- Scanner found structural indicators for this opportunity.';
  }

  return opportunity.signals
    .slice(0, 6)
    .map((signal) => {
      const location = signal.location?.line
        ? `${signal.location.file}:${signal.location.line}`
        : signal.location?.file;
      return `- ${signal.message}${location ? ` (${location})` : ''}`;
    })
    .join('\n');
}

function inferTestFile(filePath: string): string {
  const parsed = path.parse(filePath);
  if (parsed.ext === '.py') {
    return `${parsed.dir ? `${parsed.dir}/` : ''}test_${parsed.name}.py`;
  }

  if (parsed.ext === '.java') {
    return `${parsed.dir ? `${parsed.dir}/` : ''}${parsed.name}Test.java`;
  }

  return `${parsed.dir ? `${parsed.dir}/` : ''}${parsed.name}.test${parsed.ext}`;
}

function inferLikelyNewFiles(opportunity: RefactorOpportunity): string[] {
  const suggestedHelperPath = opportunity.metadata?.suggestedHelperPath;
  if (typeof suggestedHelperPath === 'string') {
    return [suggestedHelperPath];
  }

  const primaryFile = opportunity.files[0];
  if (!primaryFile) return [];

  const parsed = path.parse(primaryFile);
  const baseDirectory = parsed.dir;
  const baseName = parsed.name;

  switch (opportunity.type) {
    case 'split-large-component':
      return [
        `${baseDirectory}/${baseName}Parts.tsx`,
        `${baseDirectory}/use${toPascalCase(baseName)}Data.ts`,
      ];
    case 'extract-hook':
      return [`${baseDirectory}/use${toPascalCase(baseName)}.ts`];
    case 'extract-service-layer':
      return [inferServicePath(primaryFile, baseName)];
    case 'deduplicate-logic':
      return [inferSharedHelperPath(primaryFile, 'sharedRefactorHelper')];
    default:
      return [];
  }
}

function inferServicePath(primaryFile: string, baseName: string): string {
  if (primaryFile.endsWith('.py')) {
    return inferPythonHelperPath(primaryFile, `${baseName}_service.py`);
  }

  if (primaryFile.endsWith('.java')) {
    return inferJavaHelperPath(primaryFile, `${toPascalCase(baseName)}Service.java`);
  }

  const workspaceRoot = inferWorkspaceRoot(primaryFile);
  return `${workspaceRoot ? `${workspaceRoot}/` : ''}src/services/${baseName}Service.ts`;
}

function inferSharedHelperPath(primaryFile: string, helperName: string): string {
  if (primaryFile.endsWith('.py')) {
    return inferPythonHelperPath(primaryFile, `${toSnakeCase(helperName)}.py`);
  }

  if (primaryFile.endsWith('.java')) {
    return inferJavaHelperPath(primaryFile, `${toPascalCase(helperName)}.java`);
  }

  const workspaceRoot = inferWorkspaceRoot(primaryFile);
  return `${workspaceRoot ? `${workspaceRoot}/` : ''}src/lib/${helperName}.ts`;
}

function inferPythonHelperPath(primaryFile: string, fileName: string): string {
  const parts = primaryFile.split('/');
  const srcIndex = parts.indexOf('src');
  if (srcIndex >= 0 && parts[srcIndex + 1]) {
    return [...parts.slice(0, srcIndex + 2), 'services', fileName].join('/');
  }

  return `${path.dirname(primaryFile)}/${fileName}`;
}

function inferJavaHelperPath(primaryFile: string, fileName: string): string {
  const directory = path.dirname(primaryFile);
  if (directory.includes('/src/main/java/')) {
    return `${directory}/${fileName}`;
  }

  return `${directory}/${fileName}`;
}

function inferWorkspaceRoot(filePath: string): string | undefined {
  const parts = filePath.split('/');
  if (parts.length >= 2 && (parts[0] === 'apps' || parts[0] === 'packages')) {
    return `${parts[0]}/${parts[1]}`;
  }

  return undefined;
}

function getSuggestedHelper(opportunity: RefactorOpportunity): string | undefined {
  const helperName =
    typeof opportunity.metadata?.helperName === 'string'
      ? opportunity.metadata.helperName
      : undefined;
  const helperPath =
    typeof opportunity.metadata?.suggestedHelperPath === 'string'
      ? opportunity.metadata.suggestedHelperPath
      : undefined;

  if (helperName && helperPath) {
    return `${helperName} in ${helperPath}`;
  }

  return helperPath ?? helperName;
}

function renderContext(fileSummaries: FileAnalysis[], scanResult: ScanResult): string {
  if (fileSummaries.length === 0) {
    return `- Project framework: ${scanResult.project.framework ?? 'unknown'}`;
  }

  return fileSummaries
    .map((file) => {
      const workspace = file.workspace
        ? `${file.workspace.name ?? file.workspace.rootPath} (${file.workspace.framework ?? 'unknown'})`
        : scanResult.project.framework ?? 'unknown';
      return `- \`${file.path}\`: ${file.language}, workspace/framework: ${workspace}`;
    })
    .join('\n');
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function toPascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
