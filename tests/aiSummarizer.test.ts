import { describe, expect, it, beforeEach, vi } from 'vitest';
import { enhanceScanWithAi } from '../src/ai/aiSummarizer.ts';
import { defaultConfig } from '../src/config/defaultConfig.ts';
import type { AiProvider } from '../src/ai/providers/aiProvider.ts';
import type { FileAnalysis, RefactorOpportunity, ScanResult } from '../src/core/types.ts';
import type { Logger } from '../src/utils/logger.ts';

const providerMocks = vi.hoisted(() => ({
  completeJson: vi.fn(),
  createOpenAiProvider: vi.fn(),
  createAnthropicProvider: vi.fn(),
  createOllamaProvider: vi.fn(),
}));

vi.mock('../src/ai/providers/openaiProvider.ts', () => ({
  createOpenAiProvider: providerMocks.createOpenAiProvider,
}));

vi.mock('../src/ai/providers/anthropicProvider.ts', () => ({
  createAnthropicProvider: providerMocks.createAnthropicProvider,
}));

vi.mock('../src/ai/providers/ollamaProvider.ts', () => ({
  createOllamaProvider: providerMocks.createOllamaProvider,
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('enhanceScanWithAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerMocks.completeJson.mockResolvedValue({
      explanation: 'AI explanation',
      recommendedRefactor: ['AI step'],
      riskNotes: ['AI risk'],
      testsToAdd: ['AI test'],
      agentPrompt: 'AI prompt',
    });
    providerMocks.createOpenAiProvider.mockReturnValue(mockProvider('openai'));
    providerMocks.createAnthropicProvider.mockReturnValue(mockProvider('anthropic'));
    providerMocks.createOllamaProvider.mockReturnValue(mockProvider('ollama'));
  });

  it('only asks AI to summarize the first five opportunities with structured scan data', async () => {
    const scanResult = createScanResult(7);

    await enhanceScanWithAi(
      scanResult,
      { ...defaultConfig, ai: { ...defaultConfig.ai, enabled: true } },
      silentLogger,
    );

    expect(providerMocks.completeJson).toHaveBeenCalledTimes(5);
    expect(scanResult.opportunities[0].explanation).toBe('AI explanation');
    expect(scanResult.opportunities[4].metadata?.aiRiskNotes).toEqual(['AI risk']);
    expect(scanResult.opportunities[5].explanation).toBe('Initial explanation 6');

    const firstCall = providerMocks.completeJson.mock.calls[0][0];
    const payload = JSON.parse(firstCall.userPrompt);

    expect(firstCall.model).toBe(defaultConfig.ai.model);
    expect(payload.fileSummaries[0]).toMatchObject({
      path: 'src/target.ts',
      lineCount: 80,
      functionCount: 1,
    });
    expect(payload.fileSummaries[0]).not.toHaveProperty('content');
    expect(payload.relevantSnippets).toEqual([]);
    expect(firstCall.userPrompt).not.toContain('SOURCE_BODY_MARKER');
  });

  it('degrades cleanly when the provider cannot be created or a request fails', async () => {
    providerMocks.createOpenAiProvider.mockImplementationOnce(() => {
      throw new Error('missing key');
    });
    const missingProviderResult = createScanResult(1);

    await expect(
      enhanceScanWithAi(
        missingProviderResult,
        { ...defaultConfig, ai: { ...defaultConfig.ai, enabled: true } },
        silentLogger,
      ),
    ).resolves.toBeUndefined();
    expect(missingProviderResult.opportunities[0].explanation).toBe('Initial explanation 1');

    providerMocks.completeJson.mockRejectedValueOnce(new Error('provider failed'));
    const failedRequestResult = createScanResult(2);

    await expect(
      enhanceScanWithAi(
        failedRequestResult,
        { ...defaultConfig, ai: { ...defaultConfig.ai, enabled: true } },
        silentLogger,
      ),
    ).resolves.toBeUndefined();
    expect(failedRequestResult.opportunities[0].explanation).toBe('Initial explanation 1');
    expect(providerMocks.completeJson).toHaveBeenCalledTimes(1);
  });
});

function mockProvider(name: AiProvider['name']): AiProvider {
  return {
    name,
    completeJson: providerMocks.completeJson,
  };
}

function createScanResult(opportunityCount: number): ScanResult {
  const file: FileAnalysis = {
    path: 'src/target.ts',
    absolutePath: '/tmp/refactor-coach/src/target.ts',
    language: 'typescript',
    lineCount: 80,
    importCount: 1,
    exportCount: 1,
    functionCount: 1,
    componentCount: 0,
    hookCount: 0,
    hasTestsNearby: false,
    todoCount: 0,
    complexityScore: 18,
    responsibilities: ['business-logic'],
    signals: [
      {
        type: 'complex-function',
        message: 'target is complex.',
        severity: 'medium',
        location: { file: 'src/target.ts', line: 1 },
      },
    ],
    functions: [
      {
        name: 'target',
        startLine: 1,
        endLine: 80,
        lineCount: 80,
        parameterCount: 1,
        isAsync: false,
        hasTryCatch: false,
        tryCatchLineCount: 0,
        conditionalCount: 6,
        maxConditionalDepth: 3,
        cyclomaticComplexity: 10,
        hookCount: 0,
        apiCallCount: 0,
        apiCalls: [],
        returnsJsx: false,
      },
    ],
    importSources: [],
    dependentCount: 0,
  };

  return {
    project: {
      rootPath: '/tmp/refactor-coach',
      packageManager: 'npm',
      framework: 'unknown',
      languages: ['typescript'],
      testFramework: 'vitest',
      workspaces: [],
    },
    files: [file],
    opportunities: Array.from({ length: opportunityCount }, (_, index) =>
      createOpportunity(index + 1),
    ),
    summary: {
      filesScanned: 1,
      highPriorityCount: 0,
      mediumPriorityCount: opportunityCount,
      lowPriorityCount: 0,
      highestRiskArea: 'src/target.ts',
      bestFirstRefactor: 'src/target.ts',
    },
  };
}

function createOpportunity(index: number): RefactorOpportunity {
  return {
    id: String(index),
    title: `Simplify target ${index}`,
    type: 'simplify-complex-function',
    files: ['src/target.ts'],
    impact: 7,
    risk: 4,
    confidence: 7,
    priority: 45,
    priorityLabel: 'Medium',
    explanation: `Initial explanation ${index}`,
    suggestedSteps: ['Initial step'],
    testsToAdd: ['Initial test'],
    signals: [
      {
        type: 'complex-function',
        message: 'target is complex.',
        severity: 'medium',
        location: { file: 'src/target.ts', line: 1 },
      },
    ],
  };
}
