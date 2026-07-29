import { describe, expect, it } from 'vitest';
import { insertComposerText } from './composerTextInsert';

describe('insertComposerText', () => {
  it('inserts at the caret in empty input', () => {
    expect(insertComposerText('', 'hello world', 0, 0)).toEqual({
      nextValue: 'hello world',
      cursor: 11,
    });
  });

it('inserts at the caret and pads spaces around neighbors', () => {
    expect(insertComposerText('foo baz', 'bar', 3, 3)).toEqual({
      nextValue: 'foo bar baz',
      cursor: 7,
    });
  });

  it('replaces the current selection', () => {
    expect(insertComposerText('load freeze tool', 'thaw', 5, 11)).toEqual({
      nextValue: 'load thaw tool',
      cursor: 9,
    });
  });

  it('trims and collapses whitespace in transcript', () => {
    expect(insertComposerText('hi', '  multi\n line  ', 2, 2)).toEqual({
      nextValue: 'hi multi line',
      cursor: 13,
    });
  });

  it('ignores empty transcript', () => {
    expect(insertComposerText('keep', '   ', 2, 2)).toEqual({
      nextValue: 'keep',
      cursor: 2,
    });
  });
});
