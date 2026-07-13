/**
 * Model pricing table + cost computation for usage tracking.
 *
 * Prices are approximate USD per 1M tokens (public list prices, early 2026) and
 * are meant as a reasonable default. They can later be moved to backend config
 * or made user-editable. Models that are not recognized (including all local
 * `ollama` models) are treated as free (cost 0) to avoid showing misleading numbers.
 */

export interface ModelPricing {
  /** USD per 1M uncached input tokens */
  inputPerMtok: number;
  /** USD per 1M output tokens */
  outputPerMtok: number;
  /** USD per 1M cache-read input tokens (Anthropic: ~10% of input) */
  cacheReadPerMtok: number;
  /** USD per 1M cache-creation input tokens (Anthropic: ~125% of input) */
  cacheWritePerMtok: number;
}

export interface UsageTokens {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

const ZERO_PRICING: ModelPricing = {
  inputPerMtok: 0,
  outputPerMtok: 0,
  cacheReadPerMtok: 0,
  cacheWritePerMtok: 0,
};

interface PricingRule {
  test: (provider: string, model: string) => boolean;
  pricing: ModelPricing;
}

/** Ordered most-specific first. First match wins. */
const PRICING_RULES: PricingRule[] = [
  // --- Anthropic Claude ---
  {
    test: (p, m) => p.includes('anthropic') && /opus-4|opus4/i.test(m),
    pricing: { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  },
  {
    test: (p, m) => p.includes('anthropic') && /sonnet-4|sonnet4|claude-4-sonnet/i.test(m),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  },
  {
    test: (p, m) => p.includes('anthropic') && /3-5-sonnet|3\.5-sonnet/i.test(m),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  },
  {
    test: (p, m) => p.includes('anthropic') && /3-5-haiku|3\.5-haiku/i.test(m),
    pricing: { inputPerMtok: 0.8, outputPerMtok: 4, cacheReadPerMtok: 0.08, cacheWritePerMtok: 1 },
  },
  {
    test: (p, m) => p.includes('anthropic') && /3-opus|3\.opus/i.test(m),
    pricing: { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  },
  {
    test: (p, m) => p.includes('anthropic') && /3-haiku|3\.haiku/i.test(m),
    pricing: { inputPerMtok: 0.25, outputPerMtok: 1.25, cacheReadPerMtok: 0.025, cacheWritePerMtok: 0.3 },
  },
  {
    test: (p, _m) => p.includes('anthropic'),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  },
  // --- OpenAI ---
  {
    test: (p, m) => /openai|azure/.test(p) && /gpt-4o-mini/i.test(m),
    pricing: { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /openai|azure/.test(p) && /gpt-4o/i.test(m),
    pricing: { inputPerMtok: 2.5, outputPerMtok: 10, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /openai|azure/.test(p) && /o1/i.test(m),
    pricing: { inputPerMtok: 15, outputPerMtok: 60, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /openai|azure/.test(p) && /o3/i.test(m),
    pricing: { inputPerMtok: 10, outputPerMtok: 40, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /openai|azure/.test(p) && /gpt-4-turbo/i.test(m),
    pricing: { inputPerMtok: 10, outputPerMtok: 30, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /openai|azure/.test(p) && /gpt-3\.5/i.test(m),
    pricing: { inputPerMtok: 0.5, outputPerMtok: 1.5, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /openai|azure/.test(p) && /gpt-4/i.test(m),
    pricing: { inputPerMtok: 30, outputPerMtok: 60, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  // --- Google Gemini ---
  {
    test: (p, m) => /gemini|google/.test(p) && /2\.5-pro|2-5-pro/i.test(m),
    pricing: { inputPerMtok: 1.25, outputPerMtok: 10, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /gemini|google/.test(p) && /2\.5-flash|2-5-flash/i.test(m),
    pricing: { inputPerMtok: 0.3, outputPerMtok: 2.5, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /gemini|google/.test(p) && /2\.0-flash|2-0-flash/i.test(m),
    pricing: { inputPerMtok: 0.1, outputPerMtok: 0.4, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /gemini|google/.test(p) && /1\.5-pro|1-5-pro/i.test(m),
    pricing: { inputPerMtok: 1.25, outputPerMtok: 5, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
  {
    test: (p, m) => /gemini|google/.test(p) && /1\.5-flash|1-5-flash/i.test(m),
    pricing: { inputPerMtok: 0.075, outputPerMtok: 0.3, cacheReadPerMtok: 0, cacheWritePerMtok: 0 },
  },
];

function num(v?: number | null): number {
  return typeof v === 'number' && !Number.isNaN(v) && v > 0 ? v : 0;
}

/** Resolve pricing for a provider/model pair. Unknown/local models → all zero. */
export function getModelPricing(provider: string, model: string): ModelPricing {
  const p = (provider || '').toLowerCase();
  const m = model || '';
  if (p.includes('ollama') || p.includes('local')) {
    return ZERO_PRICING;
  }
  for (const rule of PRICING_RULES) {
    if (rule.test(p, m)) {
      return rule.pricing;
    }
  }
  return ZERO_PRICING;
}

/**
 * Compute USD cost from a usage snapshot and a pricing table.
 * Cache tokens are a subset of input tokens, so uncached input is billed at the
 * standard rate while cache-read / cache-creation tokens are billed at their
 * own (cheaper / more expensive) rates to avoid double counting.
 */
export function computeCost(usage: UsageTokens, pricing: ModelPricing): number {
  const input = num(usage.input);
  const output = num(usage.output);
  const cacheRead = num(usage.cacheRead);
  const cacheWrite = num(usage.cacheWrite);
  const uncachedInput = Math.max(0, input - cacheRead - cacheWrite);

  const cost =
    (uncachedInput / 1_000_000) * pricing.inputPerMtok +
    (output / 1_000_000) * pricing.outputPerMtok +
    (cacheRead / 1_000_000) * pricing.cacheReadPerMtok +
    (cacheWrite / 1_000_000) * pricing.cacheWritePerMtok;

  return cost;
}

/** Stable key for grouping usage by model. */
export function modelKey(provider?: string, model?: string): string {
  return `${provider || 'unknown'}:${model || 'unknown'}`;
}
