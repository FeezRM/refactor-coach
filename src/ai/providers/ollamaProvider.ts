import type { AiProvider } from './aiProvider.js';
import { parseJsonAdvice } from './aiProvider.js';

export function createOllamaProvider(
  host = process.env.OLLAMA_HOST ?? 'http://localhost:11434',
): AiProvider {
  return {
    name: 'ollama',
    async completeJson({ systemPrompt, userPrompt, model }) {
      const response = await fetch(`${host.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as { message?: { content?: string } };
      if (!data.message?.content) {
        throw new Error('Ollama response did not include content.');
      }

      return parseJsonAdvice(data.message.content);
    },
  };
}
