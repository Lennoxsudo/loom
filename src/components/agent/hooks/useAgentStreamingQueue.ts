import { useCallback, useEffect, useRef } from 'react';
import type { AgentConversationState, StreamChunkQueueItem } from '../../../types/chat';
import { applyTrustedStreamSeparation } from '../../../utils/streamChunkSeparation';
import {
  countStreamTextUnits,
  takeStreamTextUnits,
  appendThinkingStreamChunk,
} from '../../../utils/streamTextUnits';
import { drainQueueChunkBatch, FAST_DRAIN_CHARS_PER_FRAME } from '../../../utils/streamChunkDrain';
import { updateAgentMessageById } from './agentConversationUpdates';

export interface UseAgentStreamingQueueOptions {
  streamSpeed: 'fast' | 'normal' | 'slow';
  selectedAgentIdRef: React.MutableRefObject<string | null>;
  conversationStateRef: React.MutableRefObject<AgentConversationState>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  shouldSkipChunk?: (item: StreamChunkQueueItem) => boolean;
  onSetConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
}

export interface UseAgentStreamingQueueResult {
  enqueueStreamChunk: (item: StreamChunkQueueItem) => void;
  flushAllQueuedChunks: () => void;
  drainQueuedChunksFast: (onComplete?: () => void) => void;
  stopStreamChunkTimer: () => void;
  hasQueuedChunksForMessage: (messageId: string) => boolean;
}

export function useAgentStreamingQueue(
  options: UseAgentStreamingQueueOptions
): UseAgentStreamingQueueResult {
  const {
    streamSpeed,
    selectedAgentIdRef,
    conversationStateRef,
    messagesContainerRef,
    isNearBottomRef,
    shouldSkipChunk,
    onSetConversationState,
  } = options;

  const streamSpeedRef = useRef(streamSpeed);
  const streamChunkQueueRef = useRef<StreamChunkQueueItem[]>([]);
  const streamChunkTimerRef = useRef<number | null>(null);
  const fastDrainRafRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  const shouldSkipChunkRef = useRef(shouldSkipChunk);
  useEffect(() => {
    shouldSkipChunkRef.current = shouldSkipChunk;
  }, [shouldSkipChunk]);

  const shouldSkipItem = useCallback((item: StreamChunkQueueItem) => {
    return shouldSkipChunkRef.current?.(item) === true;
  }, []);

  const scheduleAutoScrollToEnd = useCallback(() => {
    if (!messagesContainerRef.current || !isNearBottomRef.current) return;
    if (autoScrollRafRef.current != null) return;

    autoScrollRafRef.current = requestAnimationFrame(() => {
      autoScrollRafRef.current = null;
      if (!messagesContainerRef.current || !isNearBottomRef.current) return;
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    });
  }, [messagesContainerRef, isNearBottomRef]);

  const applyStreamChunkBatch = useCallback(
    (items: StreamChunkQueueItem[]) => {
      if (items.length === 0) return;

      const currentAgentId = selectedAgentIdRef.current;
      const currentConvState = conversationStateRef.current;
      const currentConvId = currentConvState?.selectedConversationId;

      let shouldScroll = false;
      const validItems: StreamChunkQueueItem[] = [];
      for (const item of items) {
        if (shouldSkipItem(item)) continue;
        validItems.push(item);
        if (
          !shouldScroll &&
          item.agentId === currentAgentId &&
          item.conversationId === currentConvId
        ) {
          shouldScroll = true;
        }
      }
      if (validItems.length === 0) return;

      onSetConversationState((prev) => {
        let nextState = prev;
        for (const item of validItems) {
          const { message_id, chunk, chunk_type, conversationId } = item;
          const normalizedChunkType = chunk_type === 'thinking' ? 'thinking' : 'content';
          const chunkTime = item.chunkTime ?? Date.now();
          nextState = updateAgentMessageById(
            nextState,
            conversationId,
            message_id,
            (msg) => {
              const rawContent = msg.rawContent !== undefined ? msg.rawContent : msg.text || '';
              const rawThinking =
                msg.rawThinking !== undefined ? msg.rawThinking : msg.thinking || '';

              let nextRawContent = rawContent;
              let nextRawThinking = rawThinking;
              let nextLastThinkingChunk = msg.lastThinkingChunk;

              if (normalizedChunkType === 'thinking') {
                const appended = appendThinkingStreamChunk(
                  rawThinking || '',
                  chunk,
                  msg.lastThinkingChunk
                );
                nextRawThinking = appended.rawThinking;
                nextLastThinkingChunk = appended.lastThinkingChunk;
              } else {
                nextRawContent = (rawContent || '') + chunk;
              }

              const separated = applyTrustedStreamSeparation({
                rawContent: nextRawContent,
                rawThinking: nextRawThinking,
                chunk_type: normalizedChunkType,
                chunk,
                chunkTime,
                receivedThinkingChunks: msg.receivedThinkingChunks,
                thinkingStartedAt: msg.thinkingStartedAt,
                thinkingEndedAt: msg.thinkingEndedAt,
                firstContentTime: msg.firstContentTime,
              });

              const nextText = separated.content;
              const nextThinking = separated.thinking;
              const nextIsThinking = separated.isThinking;
              const nextReceivedThinkingChunks = separated.receivedThinkingChunks;
              const nextThinkingStartedAt = separated.thinkingStartedAt;
              const nextThinkingEndedAt = separated.thinkingEndedAt;
              const nextFirstContentTime = separated.firstContentTime;

              const noChanges =
                msg.text === nextText &&
                msg.thinking === nextThinking &&
                msg.isThinking === nextIsThinking &&
                msg.rawContent === nextRawContent &&
                msg.rawThinking === nextRawThinking &&
                msg.lastThinkingChunk === nextLastThinkingChunk &&
                msg.receivedThinkingChunks === nextReceivedThinkingChunks &&
                msg.thinkingStartedAt === nextThinkingStartedAt &&
                msg.thinkingEndedAt === nextThinkingEndedAt &&
                msg.firstContentTime === nextFirstContentTime;
              if (noChanges) {
                return msg;
              }

              return {
                ...msg,
                text: nextText,
                thinking: nextThinking,
                isThinking: nextIsThinking,
                rawContent: nextRawContent,
                rawThinking: nextRawThinking,
                lastThinkingChunk: nextLastThinkingChunk,
                receivedThinkingChunks: nextReceivedThinkingChunks,
                thinkingStartedAt: nextThinkingStartedAt,
                thinkingEndedAt: nextThinkingEndedAt,
                firstContentTime: nextFirstContentTime,
              };
            },
            { touchUpdatedAt: false }
          );
        }
        return nextState;
      });

      if (shouldScroll) {
        scheduleAutoScrollToEnd();
      }
    },
    [
      onSetConversationState,
      selectedAgentIdRef,
      conversationStateRef,
      scheduleAutoScrollToEnd,
      shouldSkipItem,
    ]
  );

  const applyStreamChunk = useCallback(
    (item: StreamChunkQueueItem) => {
      applyStreamChunkBatch([item]);
    },
    [applyStreamChunkBatch]
  );

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
    applyStreamChunkBatch(pending);
    stopStreamChunkTimer();
  }, [applyStreamChunkBatch, stopStreamChunkTimer, stopFastDrain]);

  const drainQueuedChunksFast = useCallback(
    (onComplete?: () => void) => {
      const queue = streamChunkQueueRef.current;
      if (queue.length === 0) {
        onComplete?.();
        return;
      }

      stopStreamChunkTimer();
      stopFastDrain();

      const shouldSkip = (item: StreamChunkQueueItem) => shouldSkipItem(item);

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
    [applyStreamChunk, stopStreamChunkTimer, stopFastDrain, shouldSkipItem]
  );

  const hasQueuedChunksForMessage = useCallback((messageId: string) => {
    return streamChunkQueueRef.current.some((item) => item.message_id === messageId);
  }, []);

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
    const drainedItems: StreamChunkQueueItem[] = [];

    while (remainingChars > 0 && queue.length > 0) {
      const head = queue[0];
      if (shouldSkipItem(head)) {
        queue.shift();
        continue;
      }
      const textLen = countStreamTextUnits(head.chunk);
      if (textLen <= remainingChars) {
        queue.shift();
        drainedItems.push(head);
        remainingChars -= textLen;
      } else {
        const { head: part, tail } = takeStreamTextUnits(head.chunk, remainingChars);
        head.chunk = tail;
        drainedItems.push({ ...head, chunk: part });
        remainingChars = 0;
      }
    }

    if (drainedItems.length > 0) {
      applyStreamChunkBatch(drainedItems);
    }

    if (queue.length === 0) {
      stopStreamChunkTimer();
    }
  }, [applyStreamChunkBatch, flushAllQueuedChunks, stopStreamChunkTimer, shouldSkipItem]);

  const ensureStreamChunkTimer = useCallback(() => {
    if (streamSpeedRef.current === 'fast') return;
    if (streamChunkTimerRef.current != null) return;

    const intervalMs = streamSpeedRef.current === 'slow' ? 28 : 16;
    streamChunkTimerRef.current = window.setInterval(() => {
      processQueuedChunksTick();
    }, intervalMs);
  }, [processQueuedChunksTick]);

  const enqueueStreamChunk = useCallback(
    (item: StreamChunkQueueItem) => {
      if (shouldSkipItem(item)) {
        return;
      }
      if (streamSpeedRef.current === 'fast') {
        applyStreamChunk(item);
        return;
      }
      streamChunkQueueRef.current.push(item);
      ensureStreamChunkTimer();
    },
    [applyStreamChunk, ensureStreamChunkTimer, shouldSkipItem]
  );

  useEffect(() => {
    streamSpeedRef.current = streamSpeed;
    if (streamSpeed === 'fast') {
      flushAllQueuedChunks();
      return;
    }
    if (streamChunkTimerRef.current != null) {
      stopStreamChunkTimer();
    }
    if (streamChunkQueueRef.current.length > 0) {
      ensureStreamChunkTimer();
    }
  }, [streamSpeed, flushAllQueuedChunks, stopStreamChunkTimer, ensureStreamChunkTimer]);

  useEffect(() => {
    return () => {
      stopStreamChunkTimer();
      stopFastDrain();
      if (autoScrollRafRef.current != null) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [stopStreamChunkTimer, stopFastDrain]);

  return {
    enqueueStreamChunk,
    flushAllQueuedChunks,
    drainQueuedChunksFast,
    stopStreamChunkTimer,
    hasQueuedChunksForMessage,
  };
}
