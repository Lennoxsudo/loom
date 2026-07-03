import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProjectStateMock = vi.fn();
const projectStorageKeyMock = vi.fn();

vi.mock('../../../utils/agentPersistence', () => ({
  getProjectState: (...args: unknown[]) => getProjectStateMock(...args),
  projectStorageKey: (...args: unknown[]) => projectStorageKeyMock(...args),
  getProjectsIndex: vi.fn().mockResolvedValue({ projects: [], lastActiveProjectPath: null }),
  recoverProjectStateForPath: vi.fn().mockResolvedValue(null),
}));

import { loadProjectConversationStateFromDisk } from './useAgentInit';
import { normalizeProjectPath } from '../utils';
import type { Agent } from '../../../utils/agentPersistence';

const PROJECT_A = 'D:\\proj-a';
const PROJECT_B = 'D:\\proj-b';

const sampleAgent: Agent = {
  id: 'agent-1',
  name: 'Agent',
  type: 'assistant',
  icon: 'AI',
  status: 'online',
  model: 'gpt-4o-mini',
  provider: 'openai',
  temperature: 0.3,
  capabilities: {
    canExecuteCommands: true,
    canAccessBrowser: true,
    canUseGit: true,
    canUseMcp: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('loadProjectConversationStateFromDisk', () => {
  beforeEach(() => {
    getProjectStateMock.mockReset();
    projectStorageKeyMock.mockReset();
    projectStorageKeyMock.mockImplementation(async (path: string) => normalizeProjectPath(path));
  });

  it('always reads from disk via getProjectState', async () => {
    getProjectStateMock.mockResolvedValueOnce({
      selectedConversationId: 'conv-a',
      conversations: [
        {
          id: 'conv-a',
          title: 'Thread A',
          projectPath: PROJECT_A,
          messages: [{ id: 'm1', role: 'user', text: 'hello A', createdAt: 1 }],
          createdAt: 1,
          updatedAt: 2,
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    const first = await loadProjectConversationStateFromDisk(PROJECT_A, sampleAgent);
    expect(getProjectStateMock).toHaveBeenCalledTimes(1);
    expect(first.state.conversations[0]?.messages[0]?.text).toBe('hello A');

    getProjectStateMock.mockResolvedValueOnce({
      selectedConversationId: 'conv-b',
      conversations: [
        {
          id: 'conv-b',
          title: 'Thread B',
          projectPath: PROJECT_B,
          messages: [{ id: 'm2', role: 'user', text: 'hello B', createdAt: 1 }],
          createdAt: 1,
          updatedAt: 2,
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    const second = await loadProjectConversationStateFromDisk(PROJECT_B, sampleAgent);
    expect(getProjectStateMock).toHaveBeenCalledTimes(2);
    expect(second.state.conversations[0]?.messages[0]?.text).toBe('hello B');

    getProjectStateMock.mockResolvedValueOnce({
      selectedConversationId: 'conv-a-updated',
      conversations: [
        {
          id: 'conv-a-updated',
          title: 'Updated from disk',
          projectPath: PROJECT_A,
          messages: [{ id: 'm3', role: 'user', text: 'disk changed', createdAt: 1 }],
          createdAt: 1,
          updatedAt: 2,
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    const third = await loadProjectConversationStateFromDisk(PROJECT_A, sampleAgent);
    expect(getProjectStateMock).toHaveBeenCalledTimes(3);
    expect(third.state.conversations[0]?.title).toBe('Updated from disk');
    expect(third.state.conversations[0]?.messages[0]?.text).toBe('disk changed');
  });

  it('returns empty state when project file is missing', async () => {
    getProjectStateMock.mockResolvedValueOnce(null);

    const result = await loadProjectConversationStateFromDisk(PROJECT_A, sampleAgent);
    expect(result.state.conversations).toEqual([]);
    expect(result.state.selectedConversationId).toBeNull();
  });

  it('does not restore localStorage backup when disk has an intentional empty state', async () => {
    const backupKey = normalizeProjectPath(PROJECT_A);
    localStorage.setItem(
      'loom:agent-chat-conversations:v3',
      JSON.stringify({
        [backupKey]: {
          selectedConversationId: 'conv-stale',
          conversations: [
            {
              id: 'conv-stale',
              title: 'Stale backup',
              projectPath: PROJECT_A,
              messages: [{ id: 'm1', role: 'user', text: 'should not return', createdAt: 1 }],
              createdAt: 1,
              updatedAt: 2,
              previewHistory: [],
              currentPreviewIndex: 0,
            },
          ],
        },
      })
    );

    getProjectStateMock.mockResolvedValueOnce({
      selectedConversationId: null,
      conversations: [],
    });

    const result = await loadProjectConversationStateFromDisk(PROJECT_A, sampleAgent);
    expect(result.state.conversations).toEqual([]);
    expect(result.state.selectedConversationId).toBeNull();
  });

  it('restores localStorage backup only when project file is missing', async () => {
    const backupKey = normalizeProjectPath(PROJECT_A);
    localStorage.setItem(
      'loom:agent-chat-conversations:v3',
      JSON.stringify({
        [backupKey]: {
          selectedConversationId: 'conv-backup',
          conversations: [
            {
              id: 'conv-backup',
              title: 'Backup thread',
              projectPath: PROJECT_A,
              messages: [{ id: 'm1', role: 'user', text: 'from backup', createdAt: 1 }],
              createdAt: 1,
              updatedAt: 2,
              previewHistory: [],
              currentPreviewIndex: 0,
            },
          ],
        },
      })
    );

    getProjectStateMock.mockResolvedValueOnce(null);

    const result = await loadProjectConversationStateFromDisk(PROJECT_A, sampleAgent);
    expect(result.state.conversations).toHaveLength(1);
    expect(result.state.conversations[0]?.id).toBe('conv-backup');
    expect(result.state.conversations[0]?.messages[0]?.text).toBe('from backup');
  });
});
