import { describe, expect, it } from 'vitest';
import type { AgentConversationState } from '../../types/chat';
import { normalizeProjectPath, resolveActiveProjectPath, resolveSelectedThreadId } from './utils';

const CUKTECH_PATH = 'D:\\projects\\酷态科';
const LOOM_PATH = 'D:\\projects\\Loom';

function buildState(): AgentConversationState {
  return {
    selectedConversationId: 'thread-cuktech',
    selectedConversationIdByProject: {
      [normalizeProjectPath(CUKTECH_PATH)]: 'thread-cuktech',
      [normalizeProjectPath(LOOM_PATH)]: null,
    },
    conversations: [
      {
        id: 'thread-cuktech',
        title: '项目理解与介绍',
        projectPath: CUKTECH_PATH,
        createdAt: 1,
        updatedAt: 2,
        messages: [{ id: 'm1', role: 'user', text: 'hello', createdAt: 1 }],
        previewHistory: [],
        currentPreviewIndex: 0,
      },
    ],
  };
}

describe('resolveActiveProjectPath', () => {
  it('returns the selected conversation project when restoring a window', () => {
    const state = buildState();
    expect(resolveActiveProjectPath(state, LOOM_PATH)).toBe(CUKTECH_PATH);
  });

  it('falls back to the url project when no global selection exists', () => {
    expect(resolveActiveProjectPath(undefined, LOOM_PATH)).toBe(LOOM_PATH);
  });
});

describe('normalizeProjectPath', () => {
  it('treats paths with different drive letter casing as the same project', () => {
    expect(normalizeProjectPath('D:\\projects\\酷态科')).toBe(
      normalizeProjectPath('d:\\projects\\酷态科')
    );
  });

  it('coerces non-string path values safely', () => {
    expect(normalizeProjectPath(123 as unknown as string)).toBe('123');
    expect(normalizeProjectPath(null)).toBe('');
    expect(normalizeProjectPath(undefined)).toBe('');
  });
});

describe('resolveSelectedThreadId', () => {
  it('resolves the selected thread when project path casing differs', () => {
    const state = buildState();
    expect(resolveSelectedThreadId(state, 'd:\\projects\\酷态科')).toBe('thread-cuktech');
  });

  it('returns null for compose when target project map entry is null', () => {
    const state = buildState();
    expect(resolveSelectedThreadId(state, LOOM_PATH)).toBeNull();
  });

  it('does not fall back to another project first thread when target is compose', () => {
    const state = buildState();
    expect(resolveSelectedThreadId(state, LOOM_PATH)).not.toBe('thread-cuktech');
  });
});
