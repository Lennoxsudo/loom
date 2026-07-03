import { describe, it, expect } from 'vitest';
import { canSpawnSubagent, canForkAtDepth, BACKGROUND_MAX_DEPTH } from '../nesting';

describe('subagent nesting', () => {
  it('allows foreground nesting at any depth', () => {
    expect(canSpawnSubagent(10, false)).toBe(true);
  });

  it('blocks background nesting at max depth', () => {
    expect(canSpawnSubagent(BACKGROUND_MAX_DEPTH, true)).toBe(false);
    expect(canSpawnSubagent(BACKGROUND_MAX_DEPTH - 1, true)).toBe(true);
  });

  it('forbids nested fork', () => {
    expect(canForkAtDepth(0, 'fork')).toBe(true);
    expect(canForkAtDepth(1, 'fork')).toBe(false);
  });
});
