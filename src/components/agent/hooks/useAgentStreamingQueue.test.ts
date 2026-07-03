import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAgentStreamingQueue } from './useAgentStreamingQueue';
import type { AgentConversationState, StreamChunkQueueItem } from '../../../types/chat';

function createState(messageId: string, conversationId: string): AgentConversationState {
  return {
    selectedConversationId: conversationId,
    conversations: [
      {
        id: conversationId,
        title: 'Test',
        messages: [
          {
            id: messageId,
            role: 'assistant',
            text: '',
            thinking: '',
            createdAt: 1,
            isStreaming: true,
          },
        ],
        previewHistory: [],
        currentPreviewIndex: -1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

function createChunk(
  chunk: string,
  overrides: Partial<StreamChunkQueueItem> = {}
): StreamChunkQueueItem {
  return {
    message_id: 'msg-1',
    chunk,
    chunk_type: 'content',
    agentId: 'agent-1',
    conversationId: 'conv-1',
    sessionKey: 'project::conv-1',
    chunkTime: 1,
    ...overrides,
  };
}

describe('useAgentStreamingQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderQueue(
    streamSpeed: 'fast' | 'normal' | 'slow' = 'normal',
    options?: {
      shouldSkipChunk?: (item: StreamChunkQueueItem) => boolean;
      nearBottom?: boolean;
    }
  ) {
    const conversationId = 'conv-1';
    const messageId = 'msg-1';
    let state = createState(messageId, conversationId);

    let stateUpdateCount = 0;
    const setConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>> = (
      updater
    ) => {
      stateUpdateCount += 1;
      state = typeof updater === 'function' ? updater(state) : updater;
    };

    const conversationStateRef = { current: state };
    const messagesContainerRef = {
      current: {
        scrollTop: 0,
        scrollHeight: 100,
      } as unknown as HTMLDivElement,
    };
    const hook = renderHook(() =>
      useAgentStreamingQueue({
        streamSpeed,
        selectedAgentIdRef: { current: 'agent-1' },
        conversationStateRef,
        messagesContainerRef,
        isNearBottomRef: { current: options?.nearBottom ?? false },
        shouldSkipChunk: options?.shouldSkipChunk,
        onSetConversationState: setConversationState,
      })
    );

    return {
      ...hook,
      getMessageText: () => state.conversations[0].messages[0].text,
      getState: () => state,
      getStateUpdateCount: () => stateUpdateCount,
    };
  }

  test('sets thinkingEndedAt and firstContentTime on first non-empty content chunk in fast mode', () => {
    const { result, getState } = renderQueue('fast');

    act(() => {
      result.current.enqueueStreamChunk(
        createChunk('Planning the answer.', { chunk_type: 'thinking', chunkTime: 10 })
      );
    });

    act(() => {
      result.current.enqueueStreamChunk(createChunk('Hello world', { chunkTime: 30 }));
    });

    const message = getState().conversations[0].messages[0];
    expect(message.thinking).toBe('Planning the answer.');
    expect(message.text).toBe('Hello world');
    expect(message.thinkingEndedAt).toBe(30);
    expect(message.firstContentTime).toBe(30);
  });

  test('fast mode applies chunks immediately without setInterval', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { result } = renderQueue('fast');

    act(() => {
      result.current.enqueueStreamChunk(createChunk('instant'));
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(result.current.hasQueuedChunksForMessage('msg-1')).toBe(false);
    setIntervalSpy.mockRestore();
  });

  test('normal mode drips queued chunks via setInterval', () => {
    const { result, getMessageText } = renderQueue('normal');
    const text = 'abcdefghijklmnop';

    act(() => {
      result.current.enqueueStreamChunk(createChunk(text));
    });

    expect(getMessageText()).toBe('');

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(getMessageText().length).toBe(8);
    expect(result.current.hasQueuedChunksForMessage('msg-1')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(getMessageText().length).toBeGreaterThan(8);
  });

  test('normal mode batches queue processing into a single state commit per tick', () => {
    const { result, getStateUpdateCount } = renderQueue('normal');

    act(() => {
      result.current.enqueueStreamChunk(createChunk('abcdefghijklmnop'));
    });
    const beforeTickUpdates = getStateUpdateCount();

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(getStateUpdateCount() - beforeTickUpdates).toBe(1);
  });

  test('slow mode drips slower than normal mode', () => {
    const normal = renderQueue('normal');
    const slow = renderQueue('slow');
    const text = 'abcdefghijklmnopqrstuvwxyz';

    act(() => {
      normal.result.current.enqueueStreamChunk(createChunk(text));
      slow.result.current.enqueueStreamChunk(createChunk(text));
    });

    act(() => {
      vi.advanceTimersByTime(28);
    });

    expect(normal.getMessageText().length).toBeGreaterThan(slow.getMessageText().length);
  });

  test('flushAllQueuedChunks drains the queue immediately', () => {
    const { result, getMessageText } = renderQueue('normal');

    act(() => {
      result.current.enqueueStreamChunk(createChunk('flush-me'));
    });

    act(() => {
      result.current.flushAllQueuedChunks();
    });

    expect(getMessageText()).toBe('flush-me');
    expect(result.current.hasQueuedChunksForMessage('msg-1')).toBe(false);
  });

  test('drainQueuedChunksFast completes via requestAnimationFrame batching', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    const onComplete = vi.fn();
    const { result } = renderQueue('normal');

    act(() => {
      result.current.enqueueStreamChunk(createChunk('drain-me'));
    });

    act(() => {
      result.current.drainQueuedChunksFast(onComplete);
    });

    act(() => {
      rafCallbacks.forEach((cb) => cb(0));
    });

    expect(onComplete).toHaveBeenCalled();
    expect(result.current.hasQueuedChunksForMessage('msg-1')).toBe(false);

    vi.unstubAllGlobals();
  });

  test('skips chunks matched by shouldSkipChunk', () => {
    const { result, getMessageText } = renderQueue('normal', {
      shouldSkipChunk: (item) => item.message_id === 'msg-1',
    });

    act(() => {
      result.current.enqueueStreamChunk(createChunk('skip-me'));
      vi.advanceTimersByTime(16);
    });

    expect(getMessageText()).toBe('');
  });

  test('auto-scroll is scheduled once per frame when near bottom', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    const { result } = renderQueue('fast', { nearBottom: true });

    act(() => {
      result.current.enqueueStreamChunk(createChunk('a'));
      result.current.enqueueStreamChunk(createChunk('b'));
    });

    expect(rafCallbacks.length).toBe(1);
    vi.unstubAllGlobals();
  });
});
