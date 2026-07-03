import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBAGENT_MAX_ROUNDS,
  resolveSubagentContextTokensForLoop,
  resolveSubagentContextTruncationBudget,
  resolveSubagentMaxRounds,
} from '../spawnPolicy';

describe('resolveSubagentMaxRounds', () => {
  it('prefers AI max_tool_rounds over definition maxTurns', () => {
    expect(resolveSubagentMaxRounds({ maxToolRounds: 25 }, { maxTurns: 5 })).toBe(25);
  });

  it('falls back to definition maxTurns then default', () => {
    expect(resolveSubagentMaxRounds({}, { maxTurns: 7 })).toBe(7);
    expect(resolveSubagentMaxRounds({}, {})).toBe(DEFAULT_SUBAGENT_MAX_ROUNDS);
  });
});

describe('resolveSubagentContextTruncationBudget', () => {
  it('returns null when AI does not set context_budget', () => {
    expect(resolveSubagentContextTruncationBudget({})).toBeNull();
  });

  it('clamps explicit context_budget', () => {
    expect(resolveSubagentContextTruncationBudget({ contextBudget: 1_000 })).toBe(4_000);
    expect(resolveSubagentContextTruncationBudget({ contextBudget: 50_000 })).toBe(50_000);
  });
});

describe('resolveSubagentContextTokensForLoop', () => {
  it('inherits parent maxContextTokens when no explicit budget', () => {
    expect(
      resolveSubagentContextTokensForLoop({
        parentContext: { maxContextTokens: 128_000 },
      })
    ).toBe(128_000);
  });

  it('uses explicit context_budget for loop context size', () => {
    expect(
      resolveSubagentContextTokensForLoop({
        contextBudget: 32_000,
        parentContext: { maxContextTokens: 128_000 },
      })
    ).toBe(32_000);
  });
});
