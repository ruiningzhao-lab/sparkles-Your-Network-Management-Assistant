import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, MODEL_MAIN, MODEL_QUICK } from '@/lib/config';
import { configureAI } from '@/lib/ai-core';

// Server side: the AI runs through the Anthropic API with the app's own key.
if (ANTHROPIC_API_KEY) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  configureAI(async (prompt, { tier, maxTokens, signal }) => {
    const res = await client.messages.create(
      { model: tier === 'main' ? MODEL_MAIN : MODEL_QUICK, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      { signal, timeout: 120_000 },
    );
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  });
}

export * from '@/lib/ai-core';
