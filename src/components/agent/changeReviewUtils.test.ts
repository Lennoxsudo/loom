import { describe, expect, it } from 'vitest';
import { getLanguageFromPath } from './changeReviewUtils';

describe('changeReviewUtils', () => {
  it('maps common file extensions to Monaco languages', () => {
    expect(getLanguageFromPath('src/app.tsx')).toBe('typescript');
    expect(getLanguageFromPath('README.md')).toBe('markdown');
    expect(getLanguageFromPath('data.unknown')).toBe('plaintext');
  });
});
