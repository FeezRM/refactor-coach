import type { RefactorOpportunity, ScanResult } from '../core/types.js';
import { opportunityTypeLabels } from '../opportunities/opportunityTypes.js';

export function renderMarkdownReport(scanResult: ScanResult): string {
  const topOpportunities = scanResult.opportunities.slice(0, 10);

  return `# AI Refactor Coach Report

## Summary

- Files scanned: ${scanResult.summary.filesScanned}
- High-priority opportunities: ${scanResult.summary.highPriorityCount}
- Medium-priority opportunities: ${scanResult.summary.mediumPriorityCount}
- Low-priority opportunities: ${scanResult.summary.lowPriorityCount}
- Highest-risk area: ${scanResult.summary.highestRiskArea ?? 'None found'}
- Best first refactor: ${scanResult.summary.bestFirstRefactor ?? 'None found'}
- Opportunities shown in this report: ${scanResult.opportunities.length}

## Project

- Root: \`${scanResult.project.rootPath}\`
- Package manager: ${scanResult.project.packageManager ?? 'unknown'}
- Framework: ${scanResult.project.framework ?? 'unknown'}
- Languages: ${scanResult.project.languages.length > 0 ? scanResult.project.languages.join(', ') : 'unknown'}
- Test framework: ${scanResult.project.testFramework ?? 'unknown'}
- Workspaces: ${scanResult.project.workspaces.length > 0 ? scanResult.project.workspaces.map((workspace) => `${workspace.name ?? workspace.rootPath} (${workspace.framework ?? 'unknown'})`).join(', ') : 'none detected'}

## Top Refactor Opportunities

${topOpportunities.length > 0 ? topOpportunities.map(renderOpportunity).join('\n\n') : 'No refactor opportunities found with the current thresholds.'}
`;
}

function renderOpportunity(opportunity: RefactorOpportunity): string {
  const promptPath = opportunity.aiPromptPath ? `\`${opportunity.aiPromptPath}\`` : 'Not generated';

  return `### ${opportunity.id}. ${opportunity.title}

**File:** ${opportunity.files.map((file) => `\`${file}\``).join(', ')}  
**Type:** ${opportunityTypeLabels[opportunity.type]}  
**Priority:** ${opportunity.priorityLabel} (${opportunity.priority})  
**Impact:** ${opportunity.impact}/10  
**Risk:** ${opportunity.risk}/10  
**Confidence:** ${opportunity.confidence}/10

#### Why this matters

${opportunity.explanation}

#### Recommended refactor

${opportunity.suggestedSteps.map((step) => `- ${step}`).join('\n')}

#### Tests to add first

${opportunity.testsToAdd.map((test) => `- ${test}`).join('\n')}

#### Evidence

${renderSignals(opportunity)}

#### AI Agent Prompt

See: ${promptPath}`;
}

function renderSignals(opportunity: RefactorOpportunity): string {
  if (opportunity.signals.length === 0) {
    return '- Structural heuristic matched this opportunity.';
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
