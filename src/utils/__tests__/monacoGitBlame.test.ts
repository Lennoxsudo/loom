import { describe, expect, it } from 'vitest';

import { buildGitBlameDecorations, shortenBlameAuthor } from '../monacoGitBlame';

describe('monacoGitBlame', () => {
  it('shortens long author names', () => {
    expect(shortenBlameAuthor('Alice')).toBe('Alice');
    expect(shortenBlameAuthor('Very Long Author Name Here')).toBe('Very Long Author Name…');
  });

  it('builds whole-line decorations with gutter class and inline label', () => {
    const monaco = {
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number
        ) {}
      },
    } as unknown as typeof import('monaco-editor');

    const decorations = buildGitBlameDecorations(
      monaco,
      [
        {
          commitHash: 'abc123def456',
          author: 'Alice',
          date: `${Math.floor(Date.now() / 1000) - 3600}`,
          lineNo: 3,
          content: 'const x = 1;',
        },
      ],
      'en'
    );

    expect(decorations).toHaveLength(1);
    expect(decorations[0].range.startLineNumber).toBe(3);
    expect(decorations[0].options.linesDecorationsClassName).toMatch(/^monaco-git-blame-gutter-/);
    expect(decorations[0].options.after?.inlineClassName).toBe('monaco-git-blame-inline');
    expect(decorations[0].options.after?.content).toContain('Alice');
  });
});
