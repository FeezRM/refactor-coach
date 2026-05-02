import type { AiProvider } from './aiProvider.js';
import { parseJsonAdvice } from './aiProvider.js';

export function createOpenAiProvider(apiKey = process.env.OPENAI_API_KEY): AiProvider {
  return {
    name: 'openai',
    async completeJson({ systemPrompt, userPrompt, model }) {
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set.');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI response did not include content.');
      }

      return parseJsonAdvice(content);
    },
  };
}
