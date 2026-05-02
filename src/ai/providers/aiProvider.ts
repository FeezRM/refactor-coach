import type { AiConfig } from '../../core/types.js';

export type AiRefactorAdvice = {
  explanation: string;
  recommendedRefactor: string[];
  riskNotes: string[];
  testsToAdd: string[];
  agentPrompt?: string;
};

export type AiProvider = {
  name: AiConfig['provider'];
  completeJson(input: {
    systemPrompt: string;
    userPrompt: string;
    model: string;
  }): Promise<AiRefactorAdvice>;
};

export function parseJsonAdvice(rawText: string): AiRefactorAdvice {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<AiRefactorAdvice>;
  return {
    explanation: String(parsed.explanation ?? ''),
    recommendedRefactor: Array.isArray(parsed.recommendedRefactor)
      ? parsed.recommendedRefactor.map(String)
      : [],
    riskNotes: Array.isArray(parsed.riskNotes) ? parsed.riskNotes.map(String) : [],
    testsToAdd: Array.isArray(parsed.testsToAdd) ? parsed.testsToAdd.map(String) : [],
    agentPrompt: parsed.agentPrompt ? String(parsed.agentPrompt) : undefined,
  };
}
