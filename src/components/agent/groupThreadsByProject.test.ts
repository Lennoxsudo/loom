import { describe, expect, it } from 'vitest';
import {
  collectProjectPathsFromState,
  groupThreadsByProject,
  normalizeProjectPath,
} from './utils';
import type { AgentConversationState } from '../../types/chat';

const PROJECT_A = 'D:\\test\\project';
const PROJECT_B = 'D:\\other\\project';

const state: AgentConversationState = {
  selectedConversationId: 'conv-a',
  selectedConversationIdByProject: {
    [normalizeProjectPath(PROJECT_A)]: 'conv-a',
  },
  conversations: [
    {
      id: 'conv-a',
      title: 'Thread A',
      projectPath: PROJECT_A,
      messages: [{ id: 'u1', role: 'user', text: 'Hello', createdAt: 1 }],
      updatedAt: 100,
      createdAt: 1,
      previewHistory: [],
      currentPreviewIndex: 0,
    },
    {
      id: 'conv-b',
      title: 'Thread B',
      projectPath: PROJECT_B,
      messages: [],
      updatedAt: 200,
      createdAt: 2,
      previewHistory: [],
      currentPreviewIndex: 0,
    },
  ],
};

describe('groupThreadsByProject', () => {
  it('groups conversations under normalized project keys', () => {
    const projectKeysByPath = {
      [normalizeProjectPath(PROJECT_A)]: 'key-a',
      [normalizeProjectPath(PROJECT_B)]: 'key-b',
    };
    const grouped = groupThreadsByProject(state, [PROJECT_A, PROJECT_B], projectKeysByPath);
    expect(grouped[normalizeProjectPath(PROJECT_A)]).toHaveLength(1);
    expect(grouped[normalizeProjectPath(PROJECT_A)]?.[0]?.id).toBe('conv-a');
    expect(grouped[normalizeProjectPath(PROJECT_B)]?.[0]?.id).toBe('conv-b');
    expect(grouped[normalizeProjectPath(PROJECT_B)]?.[0]?.sessionKey).toBe('key-b::conv-b');
  });
});

describe('collectProjectPathsFromState', () => {
  it('merges recent paths, active path, and conversation paths', () => {
    const paths = collectProjectPathsFromState(state, [PROJECT_A], PROJECT_B);
    expect(paths).toEqual(expect.arrayContaining([PROJECT_A, PROJECT_B]));
  });
});
