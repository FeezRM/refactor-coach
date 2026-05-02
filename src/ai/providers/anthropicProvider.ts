import type { AiProvider } from './aiProvider.js';
import { parseJsonAdvice } from './aiProvider.js';

export function createAnthropicProvider(apiKey = process.env.ANTHROPIC_API_KEY): AiProvider {
  return {
    name: 'anthropic',
    async completeJson({ systemPrompt, userPrompt, model }) {
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set.');
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1600,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = data.content?.find((item) => item.type === 'text')?.text;
      if (!text) {
        throw new Error('Anthropic response did not include text content.');
      }

      return parseJsonAdvice(text);
    },
  };
}
