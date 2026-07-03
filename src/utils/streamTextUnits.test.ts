import { describe, expect, it } from 'vitest';
import { appendThinkingStreamChunk, countStreamTextUnits, takeStreamTextUnits } from './streamTextUnits';

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (!isHigh && !isLow) continue;
    const next = text.charCodeAt(i + 1);
    const prev = text.charCodeAt(i - 1);
    if (isHigh && (next < 0xdc00 || next > 0xdfff)) return true;
    if (isLow && (prev < 0xd800 || prev > 0xdbff)) return true;
  }
  return false;
}

describe('streamTextUnits', () => {
  it('counts and takes ASCII units', () => {
    expect(countStreamTextUnits('Hello')).toBe(5);
    expect(takeStreamTextUnits('Hello', 3)).toEqual({ head: 'Hel', tail: 'lo' });
  });

  it('counts and takes CJK units', () => {
    expect(countStreamTextUnits('你好世界')).toBe(4);
    expect(takeStreamTextUnits('你好世界', 2)).toEqual({ head: '你好', tail: '世界' });
  });

  it('does not split emoji surrogate pairs', () => {
    const text = 'A😀B';
    expect(countStreamTextUnits(text)).toBe(3);
    expect(takeStreamTextUnits(text, 2)).toEqual({ head: 'A😀', tail: 'B' });
    expect(hasLoneSurrogate(takeStreamTextUnits(text, 2).head)).toBe(false);
  });

  it('keeps multi-code-point emoji as one unit when possible', () => {
    const text = '👍🏽';
    expect(countStreamTextUnits(text)).toBe(1);
    expect(takeStreamTextUnits(text, 1)).toEqual({ head: '👍🏽', tail: '' });
    expect(hasLoneSurrogate(takeStreamTextUnits(text, 1).head)).toBe(false);
  });

  it('handles empty and zero-count boundaries', () => {
    expect(countStreamTextUnits('')).toBe(0);
    expect(takeStreamTextUnits('', 3)).toEqual({ head: '', tail: '' });
    expect(takeStreamTextUnits('Hi', 0)).toEqual({ head: '', tail: 'Hi' });
    expect(takeStreamTextUnits('Hi', 10)).toEqual({ head: 'Hi', tail: '' });
  });

  it('head and tail rejoin to original text', () => {
    const samples = ['Hello', '你好😀世界', 'A👍🏽B', 'e\u0301'];
    for (const text of samples) {
      const splitAt = Math.min(2, countStreamTextUnits(text));
      const { head, tail } = takeStreamTextUnits(text, splitAt);
      expect(head + tail).toBe(text);
      expect(countStreamTextUnits(head)).toBe(splitAt);
    }
  });
});

describe('appendThinkingStreamChunk', () => {
  it('appends incremental thinking chunks', () => {
    const first = appendThinkingStreamChunk('', 'We ');
    expect(first.rawThinking).toBe('We ');
    expect(first.lastThinkingChunk).toBe('We ');

    const second = appendThinkingStreamChunk(first.rawThinking, 'need ', first.lastThinkingChunk);
    expect(second.rawThinking).toBe('We need ');
    expect(second.lastThinkingChunk).toBe('need ');
  });

  it('skips consecutive duplicate thinking chunks', () => {
    const first = appendThinkingStreamChunk('', 'We ');
    const duplicate = appendThinkingStreamChunk(first.rawThinking, 'We ', first.lastThinkingChunk);
    expect(duplicate.rawThinking).toBe('We ');
    expect(duplicate.lastThinkingChunk).toBe('We ');
  });
});
