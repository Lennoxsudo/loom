import { describe, expect, it } from 'vitest';
import type { PendingFileChange } from './utils';
import {
  computePendingChangeLineStats,
  computePendingChangeLineStatsFromChange,
  sumPendingChangeLineStats,
} from './pendingChangeStatsUtils';

function makeChange(overrides: Partial<PendingFileChange> = {}): PendingFileChange {
  return {
    id: 'change-1',
    agentId: 'agent-1',
    conversationId: 'conv-1',
    filePath: 'src/demo.ts',
    beforeContent: null,
    afterContent: '',
    toolName: 'write',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('pendingChangeStatsUtils', () => {
  it('counts all lines as added for a new file', () => {
    const stats = computePendingChangeLineStats({
      beforeContent: null,
      afterContent: 'line1\nline2\nline3',
      toolName: 'write',
    });
    expect(stats).toEqual({ added: 3, removed: 0 });
  });

  it('counts all lines as removed for a deleted file', () => {
    const stats = computePendingChangeLineStats({
      beforeContent: 'a\nb',
      afterContent: '',
      toolName: 'delete_file',
    });
    expect(stats).toEqual({ added: 0, removed: 2 });
  });

  it('diffs full file contents for modifications', () => {
    const stats = computePendingChangeLineStats({
      beforeContent: 'const x = 1;\nconst y = 2;',
      afterContent: 'const x = 2;\nconst y = 2;\nconst z = 3;',
      toolName: 'write',
    });
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
  });

  it('diffs snippet edits when before content is missing', () => {
    const stats = computePendingChangeLineStats({
      beforeContent: null,
      afterContent: 'full file',
      toolName: 'edit',
      oldSnippet: 'foo\nbar',
      newSnippet: 'foo\nbaz',
    });
    expect(stats).toEqual({ added: 1, removed: 1 });
  });

  it('sums stats across multiple pending changes', () => {
    const summary = sumPendingChangeLineStats([
      makeChange({
        beforeContent: null,
        afterContent: 'a\nb',
        toolName: 'write',
      }),
      makeChange({
        id: 'change-2',
        filePath: 'src/other.ts',
        beforeContent: 'x\ny\nz',
        afterContent: '',
        toolName: 'delete_file',
      }),
    ]);

    expect(summary).toEqual({ added: 2, removed: 3, fileCount: 2 });
  });

  it('computes stats from a pending change object', () => {
    const stats = computePendingChangeLineStatsFromChange(
      makeChange({
        beforeContent: null,
        afterContent: 'hello',
        toolName: 'write_file',
      })
    );
    expect(stats).toEqual({ added: 1, removed: 0 });
  });
});
