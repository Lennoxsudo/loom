import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { useAgentConversations } from './useAgentConversations';
import type { AgentConversationState } from '../../../types/chat';
import type { Agent } from '../../../utils/agentPersistence';
import { normalizeProjectPath, resolveSelectedThreadId } from '../utils';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../../utils/agentPersistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/agentPersistence')>();
  return {
    ...actual,
    saveProjectState: vi.fn().mockResolvedValue(undefined),
    getProjectState: vi.fn().mockResolvedValue(null),
    projectStorageKey: vi.fn(async (path: string) => normalizeProjectPath(path)),
  };
});

const PROJECT_A = 'D:\\projects\\project-a';
const PROJECT_B = 'D:\\projects\\project-b';
const PROJECT_A_KEY = normalizeProjectPath(PROJECT_A);
const PROJECT_B_KEY = normalizeProjectPath(PROJECT_B);

const selectedAgent: Agent = {
  id: 'agent-1',
  name: 'Test Agent',
  type: 'assistant',
  icon: 'AI',
  status: 'online',
  model: 'gpt-4o-mini',
  provider: 'openai',
  temperature: 0.3,
  capabilities: {
    canExecuteCommands: true,
    canAccessBrowser: false,
    canUseGit: false,
    canUseMcp: false,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createProjectBState(): AgentConversationState {
  return {
    conversations: [
      {
        id: 'thread-b1',
        title: 'Thread B1',
        projectPath: PROJECT_B,
        messages: [{ id: 'u1', role: 'user', text: 'Hello from B', createdAt: 1 }],
        updatedAt: 100,
        createdAt: 1,
        previewHistory: [],
        currentPreviewIndex: 0,
      },
      {
        id: 'thread-b2',
        title: 'Thread B2',
        projectPath: PROJECT_B,
        messages: [],
        updatedAt: 50,
        createdAt: 2,
        previewHistory: [],
        currentPreviewIndex: 0,
      },
    ],
    selectedConversationId: 'thread-b1',
    selectedConversationIdByProject: {
      [PROJECT_B_KEY]: 'thread-b1',
    },
  };
}

function createHookHarness(initialProjectPath: string, initialState: AgentConversationState) {
  let conversationState = initialState;
  const conversationStateRef = { current: conversationState };
  const onSetConversationState = vi.fn((updater: SetStateAction<AgentConversationState>) => {
    conversationState = typeof updater === 'function' ? updater(conversationState) : updater;
    conversationStateRef.current = conversationState;
  });

  return {
    getState: () => conversationState,
    options: {
      projectPath: initialProjectPath,
      activeProjectKey: normalizeProjectPath(initialProjectPath),
      agent: selectedAgent,
      conversationStateRef,
      onSetConversationState,
      onSetDraftMessage: vi.fn(),
      onSetError: vi.fn(),
      onSetRenamingConversationId: vi.fn(),
      onSetRenamingConversationTitle: vi.fn(),
      renamingConversationId: null,
      renamingConversationTitle: '',
      lastSavedSnapshotByProjectRef: { current: {} },
      draftTextareaRef: { current: null },
      onSetPendingChangesBySession: vi.fn(),
    },
  };
}

describe('useAgentConversations', () => {
  it('marks compose for the active project after switching projectPath (no stale closure)', () => {
    const initialState = createProjectBState();
    const harnessA = createHookHarness(PROJECT_A, initialState);
    const { result, rerender } = renderHook(
      (props: { projectPath: string; state: AgentConversationState }) => {
        harnessA.options.conversationStateRef.current = props.state;
        return useAgentConversations({
          ...harnessA.options,
          projectPath: props.projectPath,
          activeProjectKey: normalizeProjectPath(props.projectPath),
        });
      },
      {
        initialProps: {
          projectPath: PROJECT_A,
          state: initialState,
        },
      }
    );

    rerender({
      projectPath: PROJECT_B,
      state: harnessA.getState(),
    });

    act(() => {
      result.current.handleNewConversation();
    });

    const state = harnessA.getState();
    expect(state.selectedConversationId).toBeNull();
    expect(state.selectedConversationIdByProject?.[PROJECT_B_KEY]).toBeNull();
    expect(state.selectedConversationIdByProject?.[PROJECT_A_KEY]).toBeUndefined();
    expect(resolveSelectedThreadId(state, PROJECT_B)).toBeNull();
    expect(resolveSelectedThreadId(state, PROJECT_B)).not.toBe('thread-b1');
  });

  it('selects conversation for the active project after switching projectPath', () => {
    const initialState = createProjectBState();
    const harness = createHookHarness(PROJECT_A, initialState);
    const { result, rerender } = renderHook(
      (props: { projectPath: string; state: AgentConversationState }) => {
        harness.options.conversationStateRef.current = props.state;
        return useAgentConversations({
          ...harness.options,
          projectPath: props.projectPath,
          activeProjectKey: normalizeProjectPath(props.projectPath),
        });
      },
      {
        initialProps: {
          projectPath: PROJECT_A,
          state: initialState,
        },
      }
    );

    rerender({
      projectPath: PROJECT_B,
      state: harness.getState(),
    });

    act(() => {
      result.current.handleSelectConversation('thread-b2');
    });

    const state = harness.getState();
    expect(state.selectedConversationId).toBe('thread-b2');
    expect(state.selectedConversationIdByProject?.[PROJECT_B_KEY]).toBe('thread-b2');
  });
});
