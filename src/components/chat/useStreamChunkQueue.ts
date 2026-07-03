import { useCallback, useRef } from 'react';
import type { Message, StreamChunkQueueItem, StreamSpeed } from './types';
import { applyTrustedStreamSeparation } from '../../utils/streamChunkSeparation';
import { countStreamTextUnits, takeStreamTextUnits, appendThinkingStreamChunk } from '../../utils/streamTextUnits';
import { drainQueueChunkBatch, FAST_DRAIN_CHARS_PER_FRAME } from '../../utils/streamChunkDrain';

export interface UseStreamChunkQueueOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  canceledMessageIdsRef: React.MutableRefObject<Set<string>>;
  isMountedRef: React.MutableRefObject<boolean>;
  streamSpeedRef: React.MutableRefObject<StreamSpeed>;
}

export function useStreamChunkQueue({
  setMessages,
  canceledMessageIdsRef,
  isMountedRef,
  streamSpeedRef,
}: UseStreamChunkQueueOptions) {
  const streamChunkQueueRef = useRef<StreamChunkQueueItem[]>([]);
  const streamChunkTimerRef = useRef<number | null>(null);
  const fastDrainRafRef = useRef<number | null>(null);

  const applyStreamChunk = useCallback((item: StreamChunkQueueItem) => {
    const { message_id, chunk, chunk_type, chunkTime } = item;
    const normalizedChunkType = chunk_type === 'thinking' ? 'thinking' : 'content';

    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === message_id);
      if (index === -1) return prev;

      const updated = [...prev];
      const message = { ...updated[index] };

      if (!message.firstChunkTime) {
        message.firstChunkTime = chunkTime;
      }

      if (message.rawContent === undefined) {
        message.rawContent = message.content || '';
        message.rawThinking = message.thinking || '';
      }

      if (normalizedChunkType === 'thinking') {
        const appended = appendThinkingStreamChunk(
          message.rawThinking || '',
          chunk,
          message.lastThinkingChunk
        );
        message.rawThinking = appended.rawThinking;
        message.lastThinkingChunk = appended.lastThinkingChunk;
      } else {
        message.rawContent = (message.rawContent || '') + chunk;
      }

      const separated = applyTrustedStreamSeparation({
        rawContent: message.rawContent || '',
        rawThinking: message.rawThinking || '',
        chunk_type: normalizedChunkType,
        chunk,
        chunkTime,
        receivedThinkingChunks: message.receivedThinkingChunks,
        thinkingStartedAt: message.thinkingStartedAt,
        thinkingEndedAt: message.thinkingEndedAt,
        firstContentTime: message.firstContentTime,
      });

      message.content = separated.content;
      message.thinking = separated.thinking;
      message.isThinking = separated.isThinking;
      message.receivedThinkingChunks = separated.receivedThinkingChunks;
      message.thinkingStartedAt = separated.thinkingStartedAt;
      message.thinkingEndedAt = separated.thinkingEndedAt;
      message.firstContentTime = separated.firstContentTime;

      updated[index] = message;
      return updated;
    });
  }, [setMessages]);

  const stopFastDrain = useCallback(() => {
    if (fastDrainRafRef.current != null) {
      window.cancelAnimationFrame(fastDrainRafRef.current);
      fastDrainRafRef.current = null;
    }
  }, []);

  const stopStreamChunkTimer = useCallback(() => {
    if (streamChunkTimerRef.current != null) {
      window.clearInterval(streamChunkTimerRef.current);
      streamChunkTimerRef.current = null;
    }
  }, []);

  const flushAllQueuedChunks = useCallback(() => {
    stopFastDrain();
    if (streamChunkQueueRef.current.length === 0) {
      stopStreamChunkTimer();
      return;
    }

    const pending = streamChunkQueueRef.current;
    streamChunkQueueRef.current = [];

    for (const item of pending) {
      if (canceledMessageIdsRef.current.has(item.message_id)) continue;
      applyStreamChunk(item);
    }

    stopStreamChunkTimer();
  }, [applyStreamChunk, stopStreamChunkTimer, stopFastDrain, canceledMessageIdsRef]);

  const drainQueuedChunksFast = useCallback(
    (onComplete?: () => void) => {
      const queue = streamChunkQueueRef.current;
      if (queue.length === 0) {
        onComplete?.();
        return;
      }

      stopStreamChunkTimer();
      stopFastDrain();

      const shouldSkip = (item: StreamChunkQueueItem) =>
        canceledMessageIdsRef.current.has(item.message_id);

      const tick = () => {
        drainQueueChunkBatch(queue, applyStreamChunk, FAST_DRAIN_CHARS_PER_FRAME, shouldSkip);
        if (queue.length === 0) {
          stopFastDrain();
          onComplete?.();
        } else {
          fastDrainRafRef.current = window.requestAnimationFrame(tick);
        }
      };

      fastDrainRafRef.current = window.requestAnimationFrame(tick);
    },
    [applyStreamChunk, stopStreamChunkTimer, stopFastDrain, canceledMessageIdsRef]
  );

  const hasQueuedChunksForMessage = useCallback((messageId: string) => {
    return streamChunkQueueRef.current.some((item) => item.message_id === messageId);
  }, []);

  const flushQueuedChunksForMessage = useCallback(
    (messageId: string) => {
      stopFastDrain();
      const queue = streamChunkQueueRef.current;
      if (queue.length === 0) {
        return;
      }

      const remaining: StreamChunkQueueItem[] = [];
      const toApply: StreamChunkQueueItem[] = [];

      for (const item of queue) {
        if (item.message_id === messageId) {
          toApply.push(item);
        } else {
          remaining.push(item);
        }
      }

      streamChunkQueueRef.current = remaining;

      for (const item of toApply) {
        applyStreamChunk(item);
      }

      if (remaining.length === 0) {
        stopStreamChunkTimer();
      }
    },
    [applyStreamChunk, stopFastDrain, stopStreamChunkTimer]
  );

  const processQueuedChunksTick = useCallback(() => {
    const queue = streamChunkQueueRef.current;
    if (queue.length === 0) {
      stopStreamChunkTimer();
      return;
    }

    const speed = streamSpeedRef.current;
    if (speed === 'fast') {
      flushAllQueuedChunks();
      return;
    }

    let remainingChars = speed === 'slow' ? 1 : 8;

    while (remainingChars > 0 && queue.length > 0) {
      const head = queue[0];

      if (canceledMessageIdsRef.current.has(head.message_id)) {
        queue.shift();
        continue;
      }

      const textLen = countStreamTextUnits(head.chunk);
      if (textLen <= remainingChars) {
        queue.shift();
        applyStreamChunk(head);
        remainingChars -= textLen;
      } else {
        const { head: part, tail } = takeStreamTextUnits(head.chunk, remainingChars);
        head.chunk = tail;
        applyStreamChunk({ ...head, chunk: part });
        remainingChars = 0;
      }
    }

    if (queue.length === 0) {
      stopStreamChunkTimer();
    }
  }, [applyStreamChunk, flushAllQueuedChunks, stopStreamChunkTimer, canceledMessageIdsRef, streamSpeedRef]);

  const ensureStreamChunkTimer = useCallback(() => {
    if (streamSpeedRef.current === 'fast') return;
    if (streamChunkTimerRef.current != null) return;

    const intervalMs = streamSpeedRef.current === 'slow' ? 28 : 16;
    streamChunkTimerRef.current = window.setInterval(() => {
      if (!isMountedRef.current) {
        stopStreamChunkTimer();
        return;
      }
      processQueuedChunksTick();
    }, intervalMs);
  }, [processQueuedChunksTick, stopStreamChunkTimer, isMountedRef, streamSpeedRef]);

  const enqueueStreamChunk = useCallback(
    (item: StreamChunkQueueItem) => {
      if (streamSpeedRef.current === 'fast') {
        if (canceledMessageIdsRef.current.has(item.message_id)) return;
        applyStreamChunk(item);
        return;
      }

      streamChunkQueueRef.current.push(item);
      ensureStreamChunkTimer();
    },
    [applyStreamChunk, ensureStreamChunkTimer, canceledMessageIdsRef, streamSpeedRef]
  );

  return {
    streamChunkQueueRef,
    streamChunkTimerRef,
    applyStreamChunk,
    stopStreamChunkTimer,
    flushAllQueuedChunks,
    drainQueuedChunksFast,
    hasQueuedChunksForMessage,
    flushQueuedChunksForMessage,
    processQueuedChunksTick,
    ensureStreamChunkTimer,
    enqueueStreamChunk,
  };
}
