import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isManualCancelError } from '../utils';
import { updateAgentConversationById } from './agentConversationUpdates';
import type { AgentConversationState, StreamMeta, ChatMessage } from '../../../types/chat';

export interface UseAgentStreamControlOptions {
  selectedAgentId: string | null;
  selectedSessionKey: string | null;
  activeStreamMessageIdsByAgentRef: React.MutableRefObject<Record<string, Set<string>>>;
  activeStreamMessageIdsBySessionRef: React.MutableRefObject<Record<string, string>>;
  streamMetaByMessageIdRef: React.MutableRefObject<Record<string, StreamMeta>>;
  busySessionKeysRef: React.MutableRefObject<Set<string>>;
  streamFlushRef: React.MutableRefObject<{
    flushAllQueuedChunks: () => void;
    drainQueuedChunksFast: (onComplete?: () => void) => void;
  }>;
  setAgentBusy: (agentId: string, busy: boolean) => void;
  setSessionBusy: (sessionKey: string, busy: boolean) => void;
  setConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
  setError: (msg: string | null) => void;
  stopFailedText: string;
}

export interface UseAgentStreamControlResult {
  stopRequestedBySessionRef: React.MutableRefObject<Record<string, number>>;
  markStopRequested: (sessionKey: string) => void;
  isStopRequested: (sessionKey: string) => boolean;
  consumeStopRequest: (sessionKey: string) => boolean;
  clearTrackedStream: (messageId: string) => StreamMeta | null;
  handleStopStreaming: () => Promise<void>;
}

function messageHasVisibleContent(message: ChatMessage): boolean {
  return Boolean(
    message.text?.trim() ||
      message.thinking?.trim() ||
      (message.tool_calls && message.tool_calls.length > 0)
  );
}

export function useAgentStreamControl(
  options: UseAgentStreamControlOptions
): UseAgentStreamControlResult {
  const {
    selectedAgentId,
    selectedSessionKey,
    activeStreamMessageIdsByAgentRef,
    activeStreamMessageIdsBySessionRef,
    streamMetaByMessageIdRef,
    busySessionKeysRef,
    streamFlushRef,
    setAgentBusy,
    setSessionBusy,
    setConversationState,
    setError,
    stopFailedText,
  } = options;

  const activeTaskMessageIdsBySessionRef = useRef<Record<string, Set<string>>>({});
  const activeTaskAbortByMessageIdRef = useRef<Record<string, () => void>>({});
  const stopRequestedBySessionRef = useRef<Record<string, number>>({});

  const syncAgentBusyFromSessions = useCallback(
    (agentId: string) => {
      setAgentBusy(agentId, busySessionKeysRef.current.size > 0);
    },
    [busySessionKeysRef, setAgentBusy]
  );

  const markStopRequested = useCallback((sessionKey: string) => {
    if (!sessionKey) return;
    stopRequestedBySessionRef.current[sessionKey] = Date.now();
  }, []);

  const isStopRequested = useCallback((sessionKey: string) => {
    if (!sessionKey) return false;
    return !!stopRequestedBySessionRef.current[sessionKey];
  }, []);

  const consumeStopRequest = useCallback((sessionKey: string) => {
    if (!sessionKey || !stopRequestedBySessionRef.current[sessionKey]) return false;
    delete stopRequestedBySessionRef.current[sessionKey];
    return true;
  }, []);

  const clearTrackedStream = useCallback(
    (messageId: string) => {
      if (!messageId) return null;

      const meta = streamMetaByMessageIdRef.current[messageId];
      if (!meta) return null;

      delete streamMetaByMessageIdRef.current[messageId];

      const sessionKey = meta.sessionKey ?? `${meta.agentId}::${meta.conversationId}`;
      if (activeStreamMessageIdsBySessionRef.current[sessionKey] === messageId) {
        delete activeStreamMessageIdsBySessionRef.current[sessionKey];
        setSessionBusy(sessionKey, false);
      }

      const agentSet = activeStreamMessageIdsByAgentRef.current[meta.agentId];
      if (agentSet) {
        agentSet.delete(messageId);
        if (agentSet.size === 0) {
          delete activeStreamMessageIdsByAgentRef.current[meta.agentId];
        }
      }

      syncAgentBusyFromSessions(meta.agentId);

      return meta;
    },
    [
      syncAgentBusyFromSessions,
      setSessionBusy,
      streamMetaByMessageIdRef,
      activeStreamMessageIdsByAgentRef,
      activeStreamMessageIdsBySessionRef,
    ]
  );

  const handleStopStreaming = async () => {
    if (!selectedAgentId || !selectedSessionKey) return;

    markStopRequested(selectedSessionKey);

    const activeTasks = activeTaskMessageIdsBySessionRef.current[selectedSessionKey];
    if (activeTasks && activeTasks.size > 0) {
      const aborters = activeTaskAbortByMessageIdRef.current;
      for (const taskMessageId of Array.from(activeTasks)) {
        aborters[taskMessageId]?.();
      }
      for (const taskMessageId of Array.from(activeTasks)) {
        void invoke('cancel_ai_chat', { messageId: taskMessageId }).catch(() => {
          // ignore task cancel errors
        });
      }
      activeTasks.clear();
      delete activeTaskMessageIdsBySessionRef.current[selectedSessionKey];
    }

    const messageId = activeStreamMessageIdsBySessionRef.current[selectedSessionKey];
    const streamMeta = messageId ? streamMetaByMessageIdRef.current[messageId] : null;
    const streamConversationId = streamMeta?.conversationId ?? null;

    if (!messageId) {
      return;
    }

    try {
      await invoke('cancel_ai_chat', { messageId });
    } catch (cancelError) {
      if (!isManualCancelError(cancelError)) {
        setError(stopFailedText);
      }
    }

    streamFlushRef.current.flushAllQueuedChunks();

    if (streamConversationId) {
      setConversationState((prev) =>
        updateAgentConversationById(prev, streamConversationId, (conversation) => {
          const target = conversation.messages.find((message) => message.id === messageId);
          if (!target) {
            return conversation;
          }

          if (!messageHasVisibleContent(target)) {
            return {
              ...conversation,
              updatedAt: Date.now(),
              messages: conversation.messages.filter((message) => message.id !== messageId),
            };
          }

          return {
            ...conversation,
            updatedAt: Date.now(),
            messages: conversation.messages.map((message) => {
              if (message.id !== messageId) {
                return message;
              }
              return {
                ...message,
                isStreaming: false,
                isProcessingTools: false,
                thinkingEndedAt: message.thinkingEndedAt ?? Date.now(),
              };
            }),
          };
        })
      );
    }

    clearTrackedStream(messageId);
    setError(null);
  };

  return {
    stopRequestedBySessionRef,
    markStopRequested,
    isStopRequested,
    consumeStopRequest,
    clearTrackedStream,
    handleStopStreaming,
  };
}
