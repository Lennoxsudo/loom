import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../skills', async () => {
  const actual = await vi.importActual<typeof import('../skills')>('../skills');
  return {
    ...actual,
    loadSkillContent: vi.fn(),
  };
});

import {
  parseSlashSkillInvocation,
  parseLeadingSlashToken,
  filterSkillsForSlashQuery,
  replaceSlashToken,
  applySkillArguments,
  expandSkillSlashCommand,
  formatSlashCommandDisplay,
} from '../skillSlashCommand';
import { loadSkillContent, type SkillEntry } from '../skills';

const mockedLoad = vi.mocked(loadSkillContent);

function skill(partial: Partial<SkillEntry> & Pick<SkillEntry, 'name'>): SkillEntry {
  return {
    name: partial.name,
    description: partial.description ?? '',
    content: partial.content ?? '',
    scope: partial.scope ?? 'global',
    userInvocable: partial.userInvocable ?? true,
    argumentHint: partial.argumentHint ?? '',
  };
}

describe('parseSlashSkillInvocation', () => {
  it('parses /name and args', () => {
    expect(parseSlashSkillInvocation('/pr fix login')).toEqual({
      name: 'pr',
      args: 'fix login',
      raw: '/pr fix login',
    });
  });

  it('parses /name only', () => {
    expect(parseSlashSkillInvocation('/explain')).toEqual({
      name: 'explain',
      args: '',
      raw: '/explain',
    });
  });

  it('returns null for non-slash text', () => {
    expect(parseSlashSkillInvocation('hello /pr')).toBeNull();
    expect(parseSlashSkillInvocation('')).toBeNull();
  });

  it('allows hyphen and underscore names', () => {
    expect(parseSlashSkillInvocation('/code-review please')?.name).toBe('code-review');
    expect(parseSlashSkillInvocation('/my_skill')?.name).toBe('my_skill');
  });
});

describe('parseLeadingSlashToken', () => {
  it('detects leading slash partial', () => {
    expect(parseLeadingSlashToken('/pr', 3)).toEqual({
      start: 0,
      end: 3,
      query: 'pr',
    });
  });

  it('detects slash after whitespace', () => {
    expect(parseLeadingSlashToken('hi /ex', 6)).toEqual({
      start: 3,
      end: 6,
      query: 'ex',
    });
  });

  it('returns null when cursor is not at token end with slash', () => {
    expect(parseLeadingSlashToken('hello', 5)).toBeNull();
    expect(parseLeadingSlashToken('/pr fix', 7)).toBeNull();
  });
});

describe('filterSkillsForSlashQuery', () => {
  const skills = [
    skill({ name: 'pr', description: 'open a PR', userInvocable: true }),
    skill({ name: 'explain', description: 'explain code', userInvocable: true }),
    skill({ name: 'internal', description: 'hidden', userInvocable: false }),
  ];

  it('excludes non-invocable skills', () => {
    expect(filterSkillsForSlashQuery(skills, '').map((s) => s.name)).toEqual([
      'pr',
      'explain',
    ]);
  });

  it('filters by name or description', () => {
    expect(filterSkillsForSlashQuery(skills, 'pr').map((s) => s.name)).toEqual(['pr']);
    expect(filterSkillsForSlashQuery(skills, 'open').map((s) => s.name)).toEqual(['pr']);
  });
});

describe('replaceSlashToken', () => {
  it('replaces partial token with /name space', () => {
    expect(replaceSlashToken('/p', { start: 0, end: 2, query: 'p' }, 'pr')).toEqual({
      nextValue: '/pr ',
      cursor: 4,
    });
  });
});

describe('applySkillArguments', () => {
  it('replaces all $ARGUMENTS placeholders', () => {
    expect(applySkillArguments('A $ARGUMENTS B $ARGUMENTS', 'x')).toBe('A x B x');
  });

  it('replaces with empty string when no args', () => {
    expect(applySkillArguments('do: $ARGUMENTS', '')).toBe('do: ');
  });
});

describe('formatSlashCommandDisplay', () => {
  it('formats with and without args', () => {
    expect(formatSlashCommandDisplay('pr', 'fix')).toBe('/pr fix');
    expect(formatSlashCommandDisplay('pr', '')).toBe('/pr');
  });
});

describe('expandSkillSlashCommand', () => {
  beforeEach(() => {
    mockedLoad.mockReset();
  });

  it('returns plain for non-slash text', async () => {
    await expect(expandSkillSlashCommand('hello', '')).resolves.toEqual({
      kind: 'plain',
      original: 'hello',
    });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('expands known skill with $ARGUMENTS', async () => {
    mockedLoad.mockResolvedValue({
      content: 'Review:\n$ARGUMENTS',
      scope: 'project',
      userInvocable: true,
      argumentHint: '[summary]',
      description: 'review',
    });
    const result = await expandSkillSlashCommand('/pr fix login', '/repo');
    expect(result).toEqual({
      kind: 'expanded',
      original: '/pr fix login',
      skillName: 'pr',
      args: 'fix login',
      expandedText: 'Review:\nfix login',
      description: 'review',
      scope: 'project',
    });
    expect(mockedLoad).toHaveBeenCalledWith('pr', '/repo');
  });

  it('returns unknown when skill missing', async () => {
    mockedLoad.mockResolvedValue(null);
    await expect(expandSkillSlashCommand('/missing hi', '')).resolves.toEqual({
      kind: 'unknown',
      original: '/missing hi',
      skillName: 'missing',
      args: 'hi',
    });
  });
});
