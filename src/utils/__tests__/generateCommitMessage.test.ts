import { describe, expect, it } from 'vitest';
import {
  buildFileSummaryFromDiff,
  parseCommitMessageDraft,
  truncateDiffText,
  resolveCommitMessageAiRuntime,
} from '../generateCommitMessage';

describe('parseCommitMessageDraft', () => {
  it('splits conventional subject and body', () => {
    const raw = `feat(git): add AI commit message draft

- Wire generate button in GitPanel
- Truncate large staged diffs`;
    expect(parseCommitMessageDraft(raw)).toEqual({
      summary: 'feat(git): add AI commit message draft',
      description: '- Wire generate button in GitPanel\n- Truncate large staged diffs',
    });
  });

  it('strips markdown fences and quotes', () => {
    expect(parseCommitMessageDraft('```\nfix: handle empty staged set\n```')).toEqual({
      summary: 'fix: handle empty staged set',
      description: '',
    });
    expect(parseCommitMessageDraft('"chore: bump version"')).toEqual({
      summary: 'chore: bump version',
      description: '',
    });
  });

  it('truncates long subject to 72 chars', () => {
    const long = `feat: ${'x'.repeat(80)}`;
    const { summary, description } = parseCommitMessageDraft(long);
    expect(summary.length).toBeLessThanOrEqual(72);
    expect(description).toBe('');
  });
});

describe('truncateDiffText / buildFileSummaryFromDiff', () => {
  it('truncates oversized diffs', () => {
    const out = truncateDiffText('a'.repeat(100), 50);
    expect(out.length).toBeGreaterThan(50);
    expect(out).toContain('diff truncated');
  });

  it('builds file summary lines', () => {
    const summary = buildFileSummaryFromDiff({
      files: [
        { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 },
        { path: 'src/b.ts', status: 'added', additions: 10, deletions: 0 },
      ],
      summary: { total_files: 2, total_additions: 12, total_deletions: 1 },
      raw_diff: 'diff',
    });
    expect(summary).toContain('files=2 +12 -1');
    expect(summary).toContain('modified src/a.ts');
    expect(summary).toContain('added src/b.ts');
  });
});

describe('resolveCommitMessageAiRuntime', () => {
  it('uses selected provider active profile', () => {
    expect(
      resolveCommitMessageAiRuntime({
        selectedProvider: 'openai',
        profiles: {
          openai: {
            activeId: 'p1',
            items: [{ id: 'p1', models: ['gpt-4o-mini'] }],
          },
        },
      })
    ).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      profileId: 'p1',
    });
  });

  it('prefers auto-routing first entry', () => {
    expect(
      resolveCommitMessageAiRuntime({
        selectedProvider: 'anthropic',
        autoRouting: {
          enabled: true,
          entries: [{ provider: 'openai', profileId: 'r1', model: 'gpt-4o' }],
        },
      })
    ).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      profileId: 'r1',
    });
  });
});
