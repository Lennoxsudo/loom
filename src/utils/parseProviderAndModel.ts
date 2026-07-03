import type { AIProvider } from './agentPersistence';

export function parseProviderAndModel(modelValue: string): {
  provider: AIProvider;
  model: string;
  profileId?: string;
} {
  let provider: AIProvider = 'openai';
  let model = modelValue;
  let profileId: string | undefined;

  if (modelValue.includes(':')) {
    const parts = modelValue.split(':');
    const providerPart = parts[0];
    if (
      providerPart === 'openai' ||
      providerPart === 'anthropic' ||
      providerPart === 'gemini' ||
      providerPart === 'ollama'
    ) {
      provider = providerPart;
      // Composite id formats:
      // 1) provider:profileId:modelName:index
      // 2) provider:modelName
      // Keep ':' inside real model names (e.g. xxx:free).
      if (parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1])) {
        profileId = parts[1];
        model = parts.slice(2, -1).join(':') || modelValue;
      } else if (parts.length >= 2) {
        model = parts.slice(1).join(':') || modelValue;
      } else {
        model = modelValue;
      }
    }
  }

  return { provider, model, profileId };
}
