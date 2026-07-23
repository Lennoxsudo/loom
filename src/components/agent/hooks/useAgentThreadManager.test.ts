import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { useAgentThreadManager } from './useAgentThreadManager';
import type { AgentConversationState } from '../../../types/chat';
import type { Agent } from '../../../utils/agentPersistence';
import { normalizeProjectPath } from '../utils';
import { saveProjectState } from '../../../utils/agentPersistence';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../../utils/agentPersistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/agentPersistence')>();
  return {
    ...actual,
    saveProjectState: vi.fn().mockResolvedValue(undefined),
    getProjectState: vi.fn().mockResolvedValue(null),
    loadAllProjectThreadSummaries: vi.fn().mockResolvedValue({}),
    projectStorageKey: vi.fn(async (path: string) => {
      const normalized = normalizeProjectPath(path);
      if (normalized === normalizeProjectPath('D:\\other\\project')) {
        return 'disk-only-project-key';
      }
      return normalized;
    }),
  };
});

const PROJECT_PATH = 'D:\\test\\project';
const PROJECT_KEY = normalizeProjectPath(PROJECT_PATH);
const AGENT_ID = 'agent-1';

const selectedAgent: Agent = {
  id: AGENT_ID,
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

function createConversationState(): AgentConversationState {
  return {
    conversations: [
      {
        id: 'thread-a',
        title: 'Thread A',
        projectPath: PROJECT_PATH,
        messages: [{ id: 'u1', role: 'user', text: 'Hello from A', createdAt: 1 }],
        updatedAt: 100,
        createdAt: 1,
        previewHistory: [],
        currentPreviewIndex: 0,
      },
      {
        id: 'thread-b',
        title: 'Thread B',
        projectPath: 'D:\\other\\project',
        messages: [],
        updatedAt: 200,
        createdAt: 2,
        previewHistory: [],
        currentPreviewIndex: 0,
      },
    ],
    selectedConversationId: 'thread-a',
    selectedConversationIdByProject: {
      [PROJECT_KEY]: 'thread-a',
    },
  };
}

function createHookOptions(
  overrides: {
    conversationState?: AgentConversationState;
    draftMessage?: string;
    onSaveDraftForSession?: (sessionKey: string, draft: string) => void;
    onLoadDraftForSession?: (sessionKey: string) => string;
    onHydrateThreadSettings?: (settings: unknown) => void;
    onSetDraftMessage?: (draft: string) => void;
  } = {}
) {
  const conversationStateRef = {
    current: overrides.conversationState ?? createConversationState(),
  };
  let conversationState = overrides.conversationState ?? createConversationState();
  const onSetConversationState = vi.fn((updater: SetStateAction<AgentConversationState>) => {
    conversationState = typeof updater === 'function' ? updater(conversationState) : updater;
    conversationStateRef.current = conversationState;
  });
  const onSetDraftMessage = overrides.onSetDraftMessage ?? vi.fn();
  const onSaveDraftForSession = overrides.onSaveDraftForSession ?? vi.fn();
  const onLoadDraftForSession = overrides.onLoadDraftForSession ?? vi.fn(() => 'loaded draft');
  const onHydrateThreadSettings = overrides.onHydrateThreadSettings ?? vi.fn();

  return {
    options: {
      projectPath: PROJECT_PATH,
      projectPaths: [PROJECT_PATH, 'D:\\other\\project'],
      branchName: 'main',
      conversationState,
      activeProjectKey: PROJECT_KEY,
      agent: selectedAgent,
      conversationStateRef,
      onSetConversationState,
      onSetDraftMessage,
      onSetError: vi.fn(),
      onSetRenamingConversationId: vi.fn(),
      onSetRenamingConversationTitle: vi.fn(),
      renamingConversationId: null,
      renamingConversationTitle: '',
      lastSavedSnapshotByProjectRef: { current: {} },
      draftTextareaRef: { current: null },
      onSetPendingChangesBySession: vi.fn(),
      draftMessage: overrides.draftMessage ?? 'current draft',
      onHydrateThreadSettings,
      onPersistCurrentThreadSettings: vi.fn(() => ({
        provider: 'openai',
        model: 'gpt-4o-mini',
      })),
      onSaveDraftForSession,
      onLoadDraftForSession,
    },
    onSetConversationState,
    onSetDraftMessage,
    onSaveDraftForSession,
    onLoadDraftForSession,
    onHydrateThreadSettings,
    getConversationState: () => conversationState,
  };
}

describe('useAgentThreadManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('filters thread list items by project path', () => {
    const { options } = createHookOptions();
    const { result } = renderHook(() => useAgentThreadManager(options));

    expect(result.current.threadListItems).toHaveLength(1);
    expect(result.current.threadListItems[0]?.id).toBe('thread-a');
    expect(result.current.threadListItems[0]?.preview).toBe('Hello from A');
    expect(result.current.selectedThreadId).toBe('thread-a');
  });

  it('groups threads by project path', () => {
    const { options } = createHookOptions();
    const { result } = renderHook(() => useAgentThreadManager(options));

    expect(result.current.threadsByProject[PROJECT_KEY]).toHaveLength(1);
    expect(result.current.threadsByProject[PROJECT_KEY]?.[0]?.id).toBe('thread-a');
    expect(
      result.current.threadsByProject[normalizeProjectPath('D:\\other\\project')]
    ).toHaveLength(1);
    expect(
      result.current.threadsByProject[normalizeProjectPath('D:\\other\\project')]?.[0]?.id
    ).toBe('thread-b');
  });

  it('persists draft and hydrates target thread on select', () => {
    const onSetDraftMessage = vi.fn();
    const onSaveDraftForSession = vi.fn();
    const onLoadDraftForSession = vi.fn(() => 'draft for thread-a');
    const onHydrateThreadSettings = vi.fn();

    const conversationState = createConversationState();
    conversationState.conversations.push({
      id: 'thread-c',
      title: 'Thread C',
      projectPath: PROJECT_PATH,
      messages: [],
      updatedAt: 50,
      createdAt: 3,
      previewHistory: [],
      currentPreviewIndex: 0,
      threadSettings: { model: 'gpt-4o' },
    });
    conversationState.selectedConversationIdByProject![PROJECT_KEY] = 'thread-c';

    const { options } = createHookOptions({
      conversationState,
      draftMessage: 'draft before switch',
      onSetDraftMessage,
      onSaveDraftForSession,
      onLoadDraftForSession,
      onHydrateThreadSettings,
    });

    const { result } = renderHook(() => useAgentThreadManager(options));

    act(() => {
      result.current.handleSelectThread('thread-a');
    });

    expect(onSaveDraftForSession).toHaveBeenCalledWith(
      `${PROJECT_KEY}::thread-c`,
      'draft before switch'
    );
    expect(onLoadDraftForSession).toHaveBeenCalledWith(`${PROJECT_KEY}::thread-a`);
    expect(onSetDraftMessage).toHaveBeenCalledWith('draft for thread-a');
    expect(onHydrateThreadSettings).toHaveBeenCalledWith(undefined);
  });

  it('updates thread settings for the selected thread', () => {
    const { options, getConversationState } = createHookOptions();
    const { result } = renderHook(() => useAgentThreadManager(options));

    act(() => {
      result.current.updateCurrentThreadSettings({
        model: 'gpt-4.1',
        profileId: 'profile-b',
      });
    });

    const thread = getConversationState().conversations.find(
      (conversation) => conversation.id === 'thread-a'
    );
    expect(thread?.threadSettings?.model).toBe('gpt-4.1');
    expect(thread?.threadSettings?.profileId).toBe('profile-b');
  });

  it('marks compose state for a target project while active project differs', () => {
    const otherPath = 'D:\\other\\project';
    const otherKey = normalizeProjectPath(otherPath);
    const { options, getConversationState } = createHookOptions();
    const { result } = renderHook(() => useAgentThreadManager(options));

    act(() => {
      result.current.handleNewThread(otherPath);
    });

    const state = getConversationState();
    expect(state.selectedConversationId).toBeNull();
    expect(state.selectedConversationIdByProject?.[otherKey]).toBeNull();
    expect(state.selectedConversationIdByProject?.[PROJECT_KEY]).toBe('thread-a');
    expect(result.current.selectedThreadId).toBe('thread-a');
  });

  it('selects a thread in another project via explicit target path', () => {
    const otherPath = 'D:\\other\\project';
    const { options, getConversationState } = createHookOptions();
    const { result } = renderHook(() => useAgentThreadManager(options));

    act(() => {
      result.current.handleSelectThread('thread-b', otherPath);
    });

    const state = getConversationState();
    expect(state.selectedConversationId).toBe('thread-b');
    expect(state.selectedConversationIdByProject?.[normalizeProjectPath(otherPath)]).toBe(
      'thread-b'
    );
  });

  it('deletes a thread from memory and persists to disk', async () => {
    const onRefreshThreadSummaries = vi.fn().mockResolvedValue(undefined);
    const { options, getConversationState } = createHookOptions();
    const { result } = renderHook(() =>
      useAgentThreadManager({
        ...options,
        onRefreshThreadSummaries,
      })
    );

    const thread = result.current.threadListItems[0];
    expect(thread).toBeDefined();

    act(() => {
      result.current.requestDeleteThread(thread!);
    });

    await act(async () => {
      await result.current.confirmDeleteThread();
    });

    expect(getConversationState().conversations.some((c) => c.id === 'thread-a')).toBe(false);
    expect(saveProjectState).toHaveBeenCalled();
    expect(onRefreshThreadSummaries).toHaveBeenCalled();
  });

  it('deletes a thread shown only from disk summaries', async () => {
    const storageKey = 'disk-only-project-key';
    const otherPath = 'D:\\other\\project';
    const onRefreshThreadSummaries = vi.fn().mockResolvedValue(undefined);
    const { getProjectState } = await import('../../../utils/agentPersistence');
    vi.mocked(getProjectState).mockResolvedValueOnce({
      selectedConversationId: 'thread-b',
      conversations: [
        {
          id: 'thread-b',
          title: 'Thread B',
          projectPath: otherPath,
          messages: [],
          updatedAt: 200,
          createdAt: 2,
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    const { options, getConversationState } = createHookOptions({
      conversationState: {
        ...createConversationState(),
        conversations: createConversationState().conversations.filter(
          (conversation) => conversation.id !== 'thread-b'
        ),
      },
    });
    const { result } = renderHook(() =>
      useAgentThreadManager({
        ...options,
        onRefreshThreadSummaries,
        diskThreadSummariesByProject: {
          [normalizeProjectPath(otherPath)]: [
            {
              id: 'thread-b',
              title: 'Thread B',
              updatedAt: 200,
              projectPath: otherPath,
              projectKey: storageKey,
            },
          ],
        },
      })
    );

    const diskThread = result.current.threadsByProject[normalizeProjectPath(otherPath)]?.[0];
    expect(diskThread).toBeDefined();

    act(() => {
      result.current.requestDeleteThread(diskThread!);
    });

    await act(async () => {
      await result.current.confirmDeleteThread();
    });

    expect(saveProjectState).toHaveBeenCalledWith(
      storageKey,
      expect.objectContaining({ conversations: [] })
    );
    expect(getConversationState().conversations).toHaveLength(1);
    expect(onRefreshThreadSummaries).toHaveBeenCalled();
  });

  it('keeps compose state after deleting the only thread and creating a new one', async () => {
    const onRefreshThreadSummaries = vi.fn().mockResolvedValue(undefined);
    const onInvalidatePendingProjectPersist = vi.fn();
    const hookProps = createHookOptions({
      conversationState: {
        conversations: [
          {
            id: 'thread-a',
            title: 'Thread A',
            projectPath: PROJECT_PATH,
            messages: [{ id: 'u1', role: 'user', text: 'Hello', createdAt: 1 }],
            updatedAt: 100,
            createdAt: 1,
            previewHistory: [],
            currentPreviewIndex: 0,
          },
        ],
        selectedConversationId: 'thread-a',
        selectedConversationIdByProject: {
          [PROJECT_KEY]: 'thread-a',
        },
      },
    });
    const { result, rerender } = renderHook(
      (props: (typeof hookProps)['options']) => useAgentThreadManager(props),
      {
        initialProps: {
          ...hookProps.options,
          onRefreshThreadSummaries,
          onInvalidatePendingProjectPersist,
        },
      }
    );

    const thread = result.current.threadListItems[0];
    expect(thread).toBeDefined();

    act(() => {
      result.current.requestDeleteThread(thread!);
    });

    await act(async () => {
      await result.current.confirmDeleteThread();
    });

    rerender({
      ...hookProps.options,
      conversationState: hookProps.getConversationState(),
      conversationStateRef: { current: hookProps.getConversationState() },
      onRefreshThreadSummaries,
      onInvalidatePendingProjectPersist,
    });

    act(() => {
      result.current.handleNewThread(PROJECT_PATH);
    });

    const state = hookProps.getConversationState();
    expect(state.conversations.some((conversation) => conversation.id === 'thread-a')).toBe(false);
    expect(state.selectedConversationId).toBeNull();
    expect(state.selectedConversationIdByProject?.[PROJECT_KEY]).toBeNull();
    expect(result.current.selectedThreadId).toBeNull();
    expect(onInvalidatePendingProjectPersist).toHaveBeenCalled();
  });

  it('ignores non-string new-thread targets such as click events', () => {
    const { options, getConversationState } = createHookOptions();
    const { result, rerender } = renderHook(
      (props: typeof options) => useAgentThreadManager(props),
      { initialProps: options }
    );

    act(() => {
      result.current.handleNewThread({} as unknown as string);
    });

    rerender({
      ...options,
      conversationState: getConversationState(),
      conversationStateRef: { current: getConversationState() },
    });

    const state = getConversationState();
    expect(state.selectedConversationId).toBeNull();
    expect(state.selectedConversationIdByProject?.[PROJECT_KEY]).toBeNull();
    expect(result.current.selectedThreadId).toBeNull();
  });

  it('enters compose for project B after projectPath switches from A without explicit target path', () => {
    const otherPath = 'D:\\other\\project';
    const otherKey = normalizeProjectPath(otherPath);
    const bState: AgentConversationState = {
      conversations: [
        {
          id: 'thread-b1',
          title: 'Thread B1',
          projectPath: otherPath,
          messages: [{ id: 'u1', role: 'user', text: 'Hello', createdAt: 1 }],
          updatedAt: 100,
          createdAt: 1,
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
      selectedConversationId: 'thread-b1',
      selectedConversationIdByProject: {
        [otherKey]: 'thread-b1',
      },
    };
    const { options, getConversationState } = createHookOptions({
      conversationState: bState,
    });
    const { result, rerender } = renderHook(
      (props: typeof options) => useAgentThreadManager(props),
      { initialProps: options }
    );

    rerender({
      ...options,
      projectPath: otherPath,
      activeProjectKey: otherKey,
      conversationState: getConversationState(),
      conversationStateRef: { current: getConversationState() },
    });

    act(() => {
      result.current.handleNewThread();
    });

    rerender({
      ...options,
      projectPath: otherPath,
      activeProjectKey: otherKey,
      conversationState: getConversationState(),
      conversationStateRef: { current: getConversationState() },
    });

    const state = getConversationState();
    expect(state.selectedConversationId).toBeNull();
    expect(state.selectedConversationIdByProject?.[otherKey]).toBeNull();
    expect(result.current.selectedThreadId).toBeNull();
  });
});
