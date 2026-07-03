import { describe, expect, it } from 'vitest';
import { toMonacoModelUri } from './pathUtils';

describe('pathUtils', () => {
  it('encodes non-ASCII file paths when creating Monaco model URIs', () => {
    expect(toMonacoModelUri('D:\\project\\酷态科\\index.html')).toBe(
      'file:///D:/project/%E9%85%B7%E6%80%81%E7%A7%91/index.html'
    );
  });
});
