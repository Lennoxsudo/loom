import { describe, expect, it } from 'vitest';
import { insertComposerMention } from './AgentComposer';

describe('insertComposerMention', () => {
  it('inserts @mention at the end of empty input', () => {
    expect(insertComposerMention('', 'autoplan', 0, 0)).toEqual({
      nextValue: '@autoplan',
      cursor: 9,
    });
  });

  it('inserts @mention at cursor without extra trailing space at end', () => {
    expect(insertComposerMention('use ', 'benchmark', 4, 4)).toEqual({
      nextValue: 'use @benchmark',
      cursor: 14,
    });
  });

  it('replaces selected text with @mention', () => {
    expect(insertComposerMention('load freeze tool', 'freeze', 5, 11)).toEqual({
      nextValue: 'load @freeze tool',
      cursor: 12,
    });
  });
});
