import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../skills';

describe('parseFrontmatter', () => {
  it('parses description, argument-hint, user-invocable', () => {
    const raw = `---
description: Open a PR
argument-hint: "[summary]"
user-invocable: false
---
Body with $ARGUMENTS
`;
    expect(parseFrontmatter(raw)).toEqual({
      description: 'Open a PR',
      argumentHint: '[summary]',
      userInvocable: false,
      body: 'Body with $ARGUMENTS',
    });
  });

  it('defaults user-invocable to true and description from first line', () => {
    const raw = '# My skill\n\nDo the thing.';
    expect(parseFrontmatter(raw)).toEqual({
      description: 'My skill',
      argumentHint: '',
      userInvocable: true,
      body: '# My skill\n\nDo the thing.',
    });
  });

  it('accepts camelCase frontmatter keys', () => {
    const raw = `---
description: x
argumentHint: files
userInvocable: no
---
body
`;
    const parsed = parseFrontmatter(raw);
    expect(parsed.argumentHint).toBe('files');
    expect(parsed.userInvocable).toBe(false);
  });
});
