import { describe, expect, test } from 'vitest';

import { mergeRefreshedContents } from './openFilesRefresh';

describe('mergeRefreshedContents', () => {
  test('updates refreshed text files and resets them to clean', () => {
    const openFiles = {
      'D:/project/a.txt': {
        kind: 'text' as const,
        path: 'D:/project/a.txt',
        name: 'a.txt',
        content: 'old',
        isDirty: false,
      },
      'D:/project/dirty.txt': {
        kind: 'text' as const,
        path: 'D:/project/dirty.txt',
        name: 'dirty.txt',
        content: 'dirty',
        isDirty: true,
      },
    };

    const refreshed = {
      'D:/project/a.txt': 'new',
      'D:/project/dirty.txt': 'applied-from-disk',
    };

    const next = mergeRefreshedContents(openFiles, refreshed);

    expect(next['D:/project/a.txt'].content).toBe('new');
    expect(next['D:/project/a.txt'].isDirty).toBe(false);
    expect(next['D:/project/dirty.txt'].content).toBe('applied-from-disk');
    expect(next['D:/project/dirty.txt'].isDirty).toBe(false);
  });

  test('returns original when nothing changes', () => {
    const openFiles = {
      'D:/project/a.txt': {
        kind: 'text' as const,
        path: 'D:/project/a.txt',
        name: 'a.txt',
        content: 'same',
        isDirty: false,
      },
    };

    const next = mergeRefreshedContents(openFiles, { 'D:/project/a.txt': 'same' });

    expect(next).toBe(openFiles);
  });
});
