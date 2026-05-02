import type { Logger } from '../utils/logger.js';
import type { AiProvider } from './providers/aiProvider.js';
import { createAnthropicProvider } from './providers/anthropicProvider.js';
import { createOllamaProvider } from './providers/ollamaProvider.js';
import { createOpenAiProvider } from './providers/openaiProvider.js';
import type { RefactorCoachConfig, ScanResult } from '../core/types.js';
import { buildAiPromptInput } from './promptBuilder.js';

const SYSTEM_PROMPT = `You are a senior software engineer performing a refactor audit. Your job is to identify maintainability problems and propose safe, incremental refactor plans. You must not suggest broad rewrites. Prefer small, testable, behavior-preserving changes. When risk is high, recommend tests before refactoring. Be specific about files, responsibilities, and acceptance criteria. Do not invent codebase details that are not present in the provided scan data.

Return JSON with this shape:
{
  "explanation": "",
  "recommendedRefactor": [],
  "riskNotes": [],
  "testsToAdd": [],
  "agentPrompt": ""
}`;

export async function enhanceScanWithAi(
  scanResult: ScanResult,
  config: RefactorCoachConfig,
  logger: Logger,
): Promise<void> {
  if (!config.ai.enabled || scanResult.opportunities.length === 0) {
    return;
  }

  let provider: AiProvider;
  try {
    provider = createProvider(config);
  } catch (error) {
    logger.warn(`AI disabled: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  for (const opportunity of scanResult.opportunities.slice(0, 5)) {
    try {
      const advice = await provider.completeJson({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildAiPromptInput(opportunity, scanResult),
        model: config.ai.model,
      });

      if (advice.explanation) {
        opportunity.explanation = advice.explanation;
      }

      if (advice.recommendedRefactor.length > 0) {
        opportunity.suggestedSteps = advice.recommendedRefactor;
      }

      if (advice.testsToAdd.length > 0) {
        opportunity.testsToAdd = advice.testsToAdd;
      }

      if (advice.riskNotes.length > 0) {
        opportunity.metadata = {
          ...opportunity.metadata,
          aiRiskNotes: advice.riskNotes,
        };
      }

      if (advice.agentPrompt) {
        opportunity.metadata = {
          ...opportunity.metadata,
          aiAgentPrompt: advice.agentPrompt,
        };
      }
    } catch (error) {
      logger.warn(
        `AI explanation skipped for opportunity ${opportunity.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
  }
}

function createProvider(config: RefactorCoachConfig): AiProvider {
  switch (config.ai.provider) {
    case 'openai':
      return createOpenAiProvider();
    case 'ollama':
      return createOllamaProvider();
    case 'anthropic':
      return createAnthropicProvider();
  }
}
