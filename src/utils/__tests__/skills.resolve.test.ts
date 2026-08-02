import { describe, it, expect } from 'vitest';
import { normalizeSkillQuery, resolveSkillName } from '../skills';

describe('normalizeSkillQuery', () => {
  it('trims and strips leading slash and .md suffix', () => {
    expect(normalizeSkillQuery('  /Foo.md  ')).toBe('Foo');
    expect(normalizeSkillQuery('/code-review')).toBe('code-review');
    expect(normalizeSkillQuery('plain')).toBe('plain');
  });
});

describe('resolveSkillName', () => {
  const skills = [{ name: 'code-review' }, { name: 'pr' }, { name: 'my_skill' }];

  it('matches exact name', () => {
    expect(resolveSkillName('pr', skills)).toBe('pr');
  });

  it('matches case-insensitively when unique', () => {
    expect(resolveSkillName('Code-Review', skills)).toBe('code-review');
    expect(resolveSkillName('/PR', skills)).toBe('pr');
  });

  it('matches hyphen/underscore normalized when unique', () => {
    expect(resolveSkillName('my-skill', skills)).toBe('my_skill');
    expect(resolveSkillName('code_review', skills)).toBe('code-review');
  });

  it('matches unique prefix', () => {
    expect(resolveSkillName('code', skills)).toBe('code-review');
  });

  it('rejects ambiguous prefix', () => {
    const ambiguous = [{ name: 'code-review' }, { name: 'code-fix' }, { name: 'pr' }];
    expect(resolveSkillName('code', ambiguous)).toBeNull();
  });

  it('returns null for unknown', () => {
    expect(resolveSkillName('missing', skills)).toBeNull();
    expect(resolveSkillName('', skills)).toBeNull();
  });
});
