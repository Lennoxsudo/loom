import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useConversationManager } from './useConversationManager';
import type { Conversation } from './types';
import { CHAT_LAST_CONVERSATION_STORAGE_KEY } from '../../types/chat';

vi.mock('../../utils/errorHandling', () => ({
  logDebug: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function createOptions() {
  let messagesState: unknown[] = [];
  let totalTokensState = 0;
  let errorState: string | null = null;
  let pendingChangesState: unknown[] = [];
  let attachedImagesState: unknown[] = [];
  let selectedProviderState = 'anthropic';
  let selectedModelState = '';
  const chatRuntimeRef = {
    current: { provider: 'anthropic' as const, model: '', routingMode: 'manual' as const },
  };

  return {
    isLoading: false,
    isStopping: false,
    isExecutingToolsRef: { current: false },
    currentAssistantMessageId: null,
    setCurrentAssistantMessageId: vi.fn(),
    setIsLoading: vi.fn(),
    setIsStopping: vi.fn(),
    isMountedRef: { current: true },
    messagesRef: { current: [] },
    currentConversationRef: { current: null },
    canceledMessageIdsRef: { current: new Set<string>() },
    toolAbortControllerRef: { current: null },
    chatRulesInjectedRef: { current: false },
    autoTitleRequestedRef: { current: new Set<string>() },
    setMessages: vi.fn((updater) => {
      messagesState = typeof updater === 'function' ? updater(messagesState) : updater;
    }),
    setTotalTokens: vi.fn((updater) => {
      totalTokensState = typeof updater === 'function' ? updater(totalTokensState) : updater;
    }),
    setError: vi.fn((updater) => {
      errorState = typeof updater === 'function' ? updater(errorState) : updater;
    }),
    setProtocolSelection: vi.fn((updater) => {
      selectedProviderState =
        typeof updater === 'function' ? updater(selectedProviderState) : updater;
    }),
    setSelectedModel: vi.fn((updater) => {
      selectedModelState = typeof updater === 'function' ? updater(selectedModelState) : updater;
    }),
    chatRuntimeRef,
    setAttachedFiles: vi.fn(),
    clearAttachedImages: vi.fn(),
    setAttachedImages: vi.fn((updater) => {
      attachedImagesState =
        typeof updater === 'function' ? updater(attachedImagesState) : updater;
    }),
    pendingChangesRef: { current: [] },
    setPendingChanges: vi.fn((updater) => {
      pendingChangesState =
        typeof updater === 'function' ? updater(pendingChangesState) : updater;
    }),
  };
}

describe('useConversationManager', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  it('persists the last opened conversation immediately after load succeeds', async () => {
    const conversation: Conversation = {
      id: 'conv-1',
      title: 'Remember me',
      filename: 'conv-1.json',
      created_at: '2026-05-03T10:00:00.000Z',
      last_used_at: '2026-05-03T10:00:00.000Z',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      messages: [],
    };

    invokeMock.mockImplementation(async (command) => {
      if (command === 'load_conversation') {
        return conversation;
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useConversationManager(createOptions()));

    await act(async () => {
      await result.current.loadConversation(conversation.filename);
    });

    expect(localStorage.getItem(CHAT_LAST_CONVERSATION_STORAGE_KEY)).toBe(conversation.filename);
  });
});
