import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useStreamChunkQueue } from './useStreamChunkQueue';
import type { Message } from './types';

describe('useStreamChunkQueue', () => {
  test('separates thinking tags carried inside content chunks in normal chat', () => {
    let messages: Message[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'fast' },
      })
    );

    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-1',
        chunk: '<thinking>\nThe edit was successful.',
        chunk_type: 'content',
        chunkTime: 10,
      });
    });

    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-1',
        chunk: '\nLet me confirm the final state of the file.\n</thinking>\n\nVisible final answer',
        chunk_type: 'content',
        chunkTime: 20,
      });
    });

    expect(messages[0].thinking).toContain('The edit was successful.');
    expect(messages[0].thinking).toContain('Let me confirm the final state of the file.');
    expect(messages[0].thinking).not.toContain('<thinking>');
    expect(messages[0].content).toBe('Visible final answer');
    expect(messages[0].thinkingEndedAt).toBe(20);
  });

  test('correctly handles split thinking streams starting with <think>', () => {
    let messages: Message[] = [
      {
        id: 'msg-2',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'fast' },
      })
    );

    // 1. Chunk starts with <think> tag
    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-2',
        chunk: '<think>',
        chunk_type: 'content',
        chunkTime: 10,
      });
    });
    expect(messages[0].isThinking).toBe(true);
    expect(messages[0].thinking).toBe('');
    expect(messages[0].content).toBe('');

    // 2. Chunk with thinking text (should go to thinking)
    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-2',
        chunk: 'First line of thinking\n',
        chunk_type: 'content',
        chunkTime: 20,
      });
    });
    expect(messages[0].isThinking).toBe(true);
    expect(messages[0].thinking).toBe('First line of thinking\n');
    expect(messages[0].content).toBe('');

    // 3. Another thinking line
    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-2',
        chunk: 'Second line of thinking',
        chunk_type: 'content',
        chunkTime: 30,
      });
    });
    expect(messages[0].isThinking).toBe(true);
    expect(messages[0].thinking).toBe('First line of thinking\nSecond line of thinking');
    expect(messages[0].content).toBe('');

    // 4. Closing tag and final answer
    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-2',
        chunk: '</think>\nVisible final answer',
        chunk_type: 'content',
        chunkTime: 40,
      });
    });
    expect(messages[0].isThinking).toBe(false);
    expect(messages[0].thinking).toBe('First line of thinking\nSecond line of thinking');
    expect(messages[0].content).toBe('Visible final answer');
    expect(messages[0].thinkingEndedAt).toBe(40);
  });

  test('correctly handles separate thinking stream chunks', () => {
    let messages: Message[] = [
      {
        id: 'msg-3',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'fast' },
      })
    );

    // 1. Chunk type is 'thinking'
    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-3',
        chunk: 'This is thinking content.',
        chunk_type: 'thinking',
        chunkTime: 10,
      });
    });
    expect(messages[0].isThinking).toBe(true);
    expect(messages[0].thinking).toBe('This is thinking content.');
    expect(messages[0].content).toBe('');

    // 2. Chunk type is 'content' (should transition thinking to false immediately)
    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-3',
        chunk: 'This is final answer content.',
        chunk_type: 'content',
        chunkTime: 20,
      });
    });
    expect(messages[0].isThinking).toBe(false);
    expect(messages[0].thinking).toBe('This is thinking content.');
    expect(messages[0].content).toBe('This is final answer content.');
    expect(messages[0].thinkingEndedAt).toBe(20);
  });

  test('keeps reasoning stream chunks in thinking bubble before completion', () => {
    let messages: Message[] = [
      {
        id: 'msg-4',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'fast' },
      })
    );

    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-4',
        chunk: 'Let me inspect the files first.\n\n',
        chunk_type: 'thinking',
        chunkTime: 10,
      });
    });

    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-4',
        chunk: '## Summary\n\nThe project uses React and Tauri.',
        chunk_type: 'thinking',
        chunkTime: 20,
      });
    });

    expect(messages[0].content).toBe('');
    expect(messages[0].thinking).toContain('## Summary');
    expect(messages[0].thinking).toContain('The project uses React and Tauri.');
    expect(messages[0].isThinking).toBe(true);
    expect(messages[0].thinkingEndedAt).toBeUndefined();
  });

  test('skips consecutive duplicate thinking chunks', () => {
    let messages: Message[] = [
      {
        id: 'msg-dedupe',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'fast' },
      })
    );

    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-dedupe',
        chunk: 'We ',
        chunk_type: 'thinking',
        chunkTime: 10,
      });
      result.current.applyStreamChunk({
        message_id: 'msg-dedupe',
        chunk: 'We ',
        chunk_type: 'thinking',
        chunkTime: 11,
      });
      result.current.applyStreamChunk({
        message_id: 'msg-dedupe',
        chunk: 'need ',
        chunk_type: 'thinking',
        chunkTime: 12,
      });
    });

    expect(messages[0].thinking).toBe('We need ');
  });

  test('does not leak Chinese reasoning to body during thinking-only stream', () => {
    let messages: Message[] = [
      {
        id: 'msg-5',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'fast' },
      })
    );

    act(() => {
      result.current.applyStreamChunk({
        message_id: 'msg-5',
        chunk: '好的。让我先分析项目结构。\n\n',
        chunk_type: 'thinking',
        chunkTime: 10,
      });
    });

    expect(messages[0].content).toBe('');
    expect(messages[0].thinking).toContain('让我先分析项目结构');
    expect(messages[0].isThinking).toBe(true);
    expect(messages[0].thinkingEndedAt).toBeUndefined();
  });

  test('slow mode does not split emoji surrogate pairs while dequeuing', () => {
    let messages: Message[] = [
      {
        id: 'msg-emoji',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const hasLoneSurrogate = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const isHigh = code >= 0xd800 && code <= 0xdbff;
        const isLow = code >= 0xdc00 && code <= 0xdfff;
        if (!isHigh && !isLow) continue;
        const next = text.charCodeAt(i + 1);
        const prev = text.charCodeAt(i - 1);
        if (isHigh && (next < 0xdc00 || next > 0xdfff)) return true;
        if (isLow && (prev < 0xd800 || prev > 0xdbff)) return true;
      }
      return false;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: new Set<string>() },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'slow' },
      })
    );

    act(() => {
      result.current.enqueueStreamChunk({
        message_id: 'msg-emoji',
        chunk: 'Hi😀',
        chunk_type: 'content',
        chunkTime: 10,
      });
    });

    const seenContents: string[] = [];

    act(() => {
      result.current.processQueuedChunksTick();
      seenContents.push(messages[0].content);
      result.current.processQueuedChunksTick();
      seenContents.push(messages[0].content);
      result.current.processQueuedChunksTick();
      seenContents.push(messages[0].content);
    });

    for (const content of seenContents) {
      expect(hasLoneSurrogate(content)).toBe(false);
    }

    expect(messages[0].content).toBe('Hi😀');
    expect(result.current.streamChunkQueueRef.current).toHaveLength(0);
  });

  test('flushQueuedChunksForMessage applies queued chunks even after cancel flag', () => {
    let messages: Message[] = [
      {
        id: 'msg-stop',
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: 1,
        isStreaming: true,
      },
    ];

    const canceledIds = new Set<string>(['msg-stop']);
    const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };

    const { result } = renderHook(() =>
      useStreamChunkQueue({
        setMessages,
        canceledMessageIdsRef: { current: canceledIds },
        isMountedRef: { current: true },
        streamSpeedRef: { current: 'normal' },
      })
    );

    act(() => {
      result.current.enqueueStreamChunk({
        message_id: 'msg-stop',
        chunk: 'Partial answer',
        chunk_type: 'content',
        chunkTime: 10,
      });
      result.current.enqueueStreamChunk({
        message_id: 'msg-other',
        chunk: 'other',
        chunk_type: 'content',
        chunkTime: 11,
      });
    });

    expect(result.current.streamChunkQueueRef.current).toHaveLength(2);

    act(() => {
      result.current.flushQueuedChunksForMessage('msg-stop');
    });

    expect(messages[0].content).toBe('Partial answer');
    expect(result.current.streamChunkQueueRef.current).toHaveLength(1);
    expect(result.current.streamChunkQueueRef.current[0]?.message_id).toBe('msg-other');
  });
});
