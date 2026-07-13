import { describe, it, expect } from 'vitest';
import { getModelPricing, computeCost, modelKey, type UsageTokens } from './pricing';

describe('getModelPricing', () => {
  it('returns non-zero pricing for known Anthropic model', () => {
    const p = getModelPricing('anthropic', 'claude-3-5-sonnet-20241022');
    expect(p.inputPerMtok).toBeGreaterThan(0);
    expect(p.outputPerMtok).toBeGreaterThan(0);
  });

  it('matches gpt-4o pricing', () => {
    const p = getModelPricing('openai', 'gpt-4o');
    expect(p.inputPerMtok).toBe(2.5);
    expect(p.outputPerMtok).toBe(10);
  });

  it('returns zero pricing for ollama/local models', () => {
    const p = getModelPricing('ollama', 'llama3.1');
    expect(p.inputPerMtok).toBe(0);
    expect(p.outputPerMtok).toBe(0);
  });

  it('returns zero pricing for unknown model', () => {
    const p = getModelPricing('openai', 'some-future-model');
    expect(p.inputPerMtok).toBe(0);
    expect(p.outputPerMtok).toBe(0);
  });
});

describe('computeCost', () => {
  const pricing = {
    inputPerMtok: 3,
    outputPerMtok: 15,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  };

  it('computes cost from input/output at standard rate', () => {
    const usage: UsageTokens = { input: 1_000_000, output: 1_000_000 };
    // 1M uncached input * 3 + 1M output * 15 = 18
    expect(computeCost(usage, pricing)).toBeCloseTo(18, 5);
  });

  it('applies cache discounts and avoids double counting', () => {
    // 1M total input, 800k cache read, 100k cache write => 100k uncached
    const usage: UsageTokens = {
      input: 1_000_000,
      output: 0,
      cacheRead: 800_000,
      cacheWrite: 100_000,
    };
    const expected =
      (100_000 / 1e6) * 3 + (800_000 / 1e6) * 0.3 + (100_000 / 1e6) * 3.75;
    expect(computeCost(usage, pricing)).toBeCloseTo(expected, 5);
  });

  it('treats missing tokens as zero', () => {
    expect(computeCost({}, pricing)).toBe(0);
  });
});

describe('modelKey', () => {
  it('joins provider and model', () => {
    expect(modelKey('anthropic', 'claude-x')).toBe('anthropic:claude-x');
  });
});
