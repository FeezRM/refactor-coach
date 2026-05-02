import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../config/configLoader.js';
import { scanRepository } from '../../core/scanner.js';
import type { FileAnalysis, RefactorOpportunity } from '../../core/types.js';
import { relativeToRoot, toPosixPath } from '../../utils/pathUtils.js';

export function registerExplainCommand(program: Command): void {
  program
    .command('explain')
    .argument('<file>', 'File to explain.')
    .description('Explain maintainability signals for a specific file.')
    .action(async (file: string) => {
      const rootPath = process.cwd();
      const targetPath = path.resolve(rootPath, file);
      const targetRelativePath = toPosixPath(relativeToRoot(rootPath, targetPath));
      const config = loadConfig(rootPath, { noAi: true });
      const scanResult = await scanRepository(rootPath, config);
      const analysis = scanResult.files.find((candidate) => candidate.path === targetRelativePath);

      if (!analysis) {
        throw new Error(`File was not scanned: ${file}`);
      }

      const opportunities = scanResult.opportunities.filter((opportunity) =>
        opportunity.files.includes(analysis.path),
      );

      console.log(renderExplanation(analysis, opportunities));
    });
}

function renderExplanation(analysis: FileAnalysis, opportunities: RefactorOpportunity[]): string {
  const strongestFunctions = analysis.functions
    .slice()
    .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity || b.lineCount - a.lineCount)
    .slice(0, 5);

  return `# ${analysis.path}

## What This File Appears To Do

- Responsibilities: ${analysis.responsibilities.length > 0 ? analysis.responsibilities.join(', ') : 'none detected'}
- Size: ${analysis.lineCount} lines
- Imports: ${analysis.importCount}
- Exports: ${analysis.exportCount}
- Functions/components: ${analysis.functionCount} functions, ${analysis.componentCount} likely React components
- Hooks: ${analysis.hookCount}
- Nearby tests: ${analysis.hasTestsNearby ? 'yes' : 'no'}

## Why It May Be Hard To Maintain

${renderSignals(analysis)}

## Highest-Complexity Functions

${
  strongestFunctions.length > 0
    ? strongestFunctions
        .map(
          (fn) =>
            `- \`${fn.name}\` at line ${fn.startLine}: ${fn.lineCount} lines, complexity ${fn.cyclomaticComplexity}, ${fn.parameterCount} params`,
        )
        .join('\n')
    : '- No function-level complexity signals found.'
}

## Refactor Opportunities

${
  opportunities.length > 0
    ? opportunities
        .map(
          (opportunity) =>
            `- ${opportunity.id}. ${opportunity.title} (${opportunity.priorityLabel}, priority ${opportunity.priority})`,
        )
        .join('\n')
    : '- No opportunities found for this file with current thresholds.'
}

## Tests To Add First

${renderTests(opportunities, analysis)}
`;
}

function renderSignals(analysis: FileAnalysis): string {
  if (analysis.signals.length === 0) {
    return '- No major maintainability signals found with the current thresholds.';
  }

  return analysis.signals
    .map((signal) => {
      const location = signal.location?.line ? ` at line ${signal.location.line}` : '';
      return `- ${signal.message}${location}`;
    })
    .join('\n');
}

function renderTests(opportunities: RefactorOpportunity[], analysis: FileAnalysis): string {
  const tests = opportunities.flatMap((opportunity) => opportunity.testsToAdd);
  if (tests.length > 0) {
    return Array.from(new Set(tests))
      .map((test) => `- ${test}`)
      .join('\n');
  }

  if (analysis.hasTestsNearby) {
    return '- Run nearby tests before changing structure.';
  }

  return '- Add characterization tests before refactoring this file.';
}
