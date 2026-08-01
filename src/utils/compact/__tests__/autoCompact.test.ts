import { describe, it, expect } from 'vitest';
import {
  shouldAutoCompact,
  incrementCompactTurns,
  resetCompactTurns,
} from '../autoCompact';
import { MIN_TURNS_BEFORE_RECOMPACT } from '../types';
import type { CompactableMessage } from '../types';

const heavyMessages: CompactableMessage[] = Array.from({ length: 12 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  text: 'x'.repeat(400),
}));

describe('shouldAutoCompact turn gate', () => {
  it('blocks re-compact until MIN_TURNS_BEFORE_RECOMPACT turns after lastCompactedAt', () => {
    let state = resetCompactTurns(null);
    expect(state.turnsSincePreviousCompact).toBe(0);
    expect(state.lastCompactedAt).toBeTypeOf('number');

    expect(
      shouldAutoCompact({
        messages: heavyMessages,
        budgetTokens: 90,
        maxContextTokens: 100,
        reserveTokens: 0,
        compactState: state,
      })
    ).toBe(false);

    for (let i = 0; i < MIN_TURNS_BEFORE_RECOMPACT - 1; i++) {
      state = incrementCompactTurns(state);
      expect(
        shouldAutoCompact({
          messages: heavyMessages,
          budgetTokens: 90,
          maxContextTokens: 100,
          reserveTokens: 0,
          compactState: state,
        })
      ).toBe(false);
    }

    state = incrementCompactTurns(state);
    expect(state.turnsSincePreviousCompact).toBe(MIN_TURNS_BEFORE_RECOMPACT);
    expect(
      shouldAutoCompact({
        messages: heavyMessages,
        budgetTokens: 90,
        maxContextTokens: 100,
        reserveTokens: 0,
        compactState: state,
      })
    ).toBe(true);
  });
});
