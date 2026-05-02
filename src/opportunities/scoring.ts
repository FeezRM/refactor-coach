import type { FileAnalysis, RefactorOpportunity, OpportunityType } from '../core/types.js';

export function clampScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function calculatePriority(impact: number, risk: number, confidence: number): number {
  return impact * confidence - risk;
}

export function priorityLabel(priority: number): RefactorOpportunity['priorityLabel'] {
  if (priority >= 75) return 'High';
  if (priority >= 40) return 'Medium';
  return 'Low';
}

export function scoreOpportunity(
  type: OpportunityType,
  files: FileAnalysis[],
  signalStrength: number,
): Pick<RefactorOpportunity, 'impact' | 'risk' | 'confidence' | 'priority' | 'priorityLabel'> {
  const maxLineCount = Math.max(...files.map((file) => file.lineCount), 0);
  const maxComplexity = Math.max(...files.map((file) => file.complexityScore), 0);
  const maxDependents = Math.max(...files.map((file) => file.dependentCount), 0);
  const maxSignalCount = Math.max(...files.map((file) => file.signals.length), 0);
  const missingTests = files.filter((file) => !file.hasTestsNearby).length;
  const sensitive = files.some((file) =>
    file.responsibilities.some(
      (tag) => tag === 'auth' || tag === 'database' || tag === 'validation',
    ),
  );

  let impact =
    2 +
    signalStrength +
    Math.min(2, Math.floor(maxLineCount / 250)) +
    Math.min(2, Math.floor(maxComplexity / 40));
  let risk = 2 + Math.min(3, Math.floor(maxComplexity / 35)) + Math.min(2, maxDependents);
  let confidence = 4 + signalStrength + Math.min(2, Math.floor(maxSignalCount / 3));

  if (missingTests > 0) risk += 1;
  if (sensitive) risk += 2;
  if (files.length > 1) impact += 1;
  if (maxDependents > 0) impact += Math.min(2, maxDependents);

  switch (type) {
    case 'split-large-component':
      impact += 2;
      confidence += 1;
      break;
    case 'extract-hook':
      impact += 1;
      risk -= 1;
      break;
    case 'extract-service-layer':
      impact += 1;
      break;
    case 'deduplicate-logic':
      impact += files.length >= 3 ? 2 : 0;
      confidence += files.length >= 3 ? 1 : 0;
      break;
    case 'simplify-complex-function':
      impact += 1;
      break;
    case 'improve-module-boundaries':
      risk += 1;
      break;
    case 'add-tests-before-refactor':
      impact += maxComplexity >= 40 || maxLineCount >= 300 ? 1 : 0;
      risk = Math.max(1, risk - 2);
      confidence += 1;
      break;
    case 'remove-dead-code':
      impact -= 1;
      risk -= 1;
      break;
  }

  const finalImpact = clampScore(impact);
  const finalRisk = clampScore(risk);
  const finalConfidence = clampScore(confidence);
  const priority = calculatePriority(finalImpact, finalRisk, finalConfidence);

  return {
    impact: finalImpact,
    risk: finalRisk,
    confidence: finalConfidence,
    priority,
    priorityLabel: priorityLabel(priority),
  };
}
