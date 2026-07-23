import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAgentStreamControl } from './useAgentStreamControl';
import type { AgentConversationState } from '../../../types/chat';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function createHarness(options?: {
  selectedSessionKey?: string | null;
  busySessionKeys?: Set<string>;
}) {
  const activeStreamMessageIdsByAgentRef = {
    current: {} as Record<string, Set<string>>,
  };
  const activeStreamMessageIdsBySessionRef = {
    current: {} as Record<string, string>,
  };
  const streamMetaByMessageIdRef = {
    current: {} as Record<
      string,
      {
        agentId: string;
        conversationId: string;
        sessionKey: string;
      }
    >,
  };
  const busySessionKeysRef = {
    current: options?.busySessionKeys ?? new Set<string>(),
  };
  const streamFlushRef = {
    current: {
      flushAllQueuedChunks: vi.fn(),
      drainQueuedChunksFast: vi.fn(),
    },
  };

  let conversationState: AgentConversationState = {
    selectedConversationId: 'conv-a',
    conversations: [
      {
        id: 'conv-a',
        title: 'A',
        messages: [
          {
            id: 'msg-a',
            role: 'assistant',
            text: 'partial',
            createdAt: 1,
            isStreaming: true,
          },
        ],
        previewHistory: [],
        currentPreviewIndex: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'conv-b',
        title: 'B',
        messages: [
          {
            id: 'msg-b',
            role: 'assistant',
            text: '',
            createdAt: 1,
            isStreaming: true,
          },
        ],
        previewHistory: [],
        currentPreviewIndex: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };

  const setSessionBusy = vi.fn((sessionKey: string, busy: boolean) => {
    if (busy) {
      busySessionKeysRef.current.add(sessionKey);
    } else {
      busySessionKeysRef.current.delete(sessionKey);
    }
  });
  const setAgentBusy = vi.fn();
  const setError = vi.fn();

  streamMetaByMessageIdRef.current['msg-a'] = {
    agentId: 'agent-1',
    conversationId: 'conv-a',
    sessionKey: 'pk::conv-a',
  };
  streamMetaByMessageIdRef.current['msg-b'] = {
    agentId: 'agent-1',
    conversationId: 'conv-b',
    sessionKey: 'pk::conv-b',
  };
  activeStreamMessageIdsBySessionRef.current['pk::conv-a'] = 'msg-a';
  activeStreamMessageIdsBySessionRef.current['pk::conv-b'] = 'msg-b';
  activeStreamMessageIdsByAgentRef.current['agent-1'] = new Set(['msg-a', 'msg-b']);
  busySessionKeysRef.current = new Set(['pk::conv-a', 'pk::conv-b']);

  const hook = renderHook(() =>
    useAgentStreamControl({
      selectedAgentId: 'agent-1',
      selectedSessionKey: options?.selectedSessionKey ?? 'pk::conv-b',
      activeStreamMessageIdsByAgentRef,
      activeStreamMessageIdsBySessionRef,
      streamMetaByMessageIdRef,
      busySessionKeysRef,
      streamFlushRef,
      setAgentBusy,
      setSessionBusy,
      setConversationState: (updater) => {
        conversationState = typeof updater === 'function' ? updater(conversationState) : updater;
      },
      setError,
      stopFailedText: 'stop failed',
    })
  );

  return {
    hook,
    refs: {
      activeStreamMessageIdsByAgentRef,
      activeStreamMessageIdsBySessionRef,
      streamMetaByMessageIdRef,
      busySessionKeysRef,
    },
    setSessionBusy,
    setAgentBusy,
    getConversationState: () => conversationState,
  };
}

describe('useAgentStreamControl', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  test('stop flags are isolated per session', () => {
    const { hook } = createHarness();

    act(() => {
      hook.result.current.markStopRequested('pk::conv-b');
    });

    expect(hook.result.current.isStopRequested('pk::conv-b')).toBe(true);
    expect(hook.result.current.isStopRequested('pk::conv-a')).toBe(false);

    act(() => {
      expect(hook.result.current.consumeStopRequest('pk::conv-b')).toBe(true);
    });

    expect(hook.result.current.isStopRequested('pk::conv-b')).toBe(false);
  });

  test('handleStopStreaming only cancels the selected session stream', async () => {
    const { hook } = createHarness({ selectedSessionKey: 'pk::conv-b' });

    await act(async () => {
      await hook.result.current.handleStopStreaming();
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('cancel_ai_chat', { messageId: 'msg-b' });
    expect(hook.result.current.isStopRequested('pk::conv-a')).toBe(false);
  });

  test('clearTrackedStream keeps agent busy while another session is still streaming', () => {
    const { hook, setAgentBusy, refs } = createHarness();

    act(() => {
      hook.result.current.clearTrackedStream('msg-a');
    });

    expect(refs.activeStreamMessageIdsBySessionRef.current['pk::conv-a']).toBeUndefined();
    expect(refs.activeStreamMessageIdsBySessionRef.current['pk::conv-b']).toBe('msg-b');
    expect(refs.activeStreamMessageIdsByAgentRef.current['agent-1']?.has('msg-b')).toBe(true);
    expect(setAgentBusy).toHaveBeenCalledWith('agent-1', true);
  });
});
