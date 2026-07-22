import { useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logDebug } from '../../utils/errorHandling';
import type { Message } from './types';

export interface UseStopHandlerOptions {
  currentAssistantMessageId: string | null;
  setCurrentAssistantMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isStopping: boolean;
  setIsStopping: React.Dispatch<React.SetStateAction<boolean>>;
  isExecutingToolsRef: React.MutableRefObject<boolean>;
  toolAbortControllerRef: React.MutableRefObject<AbortController | null>;
  canceledMessageIdsRef: React.MutableRefObject<Set<string>>;
  ownedStreamMessageIdsRef: React.MutableRefObject<Set<string>>;
  flushQueuedChunksForMessage: (messageId: string) => void;
  cancelStreamCompletion: (messageId: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  autoSaveTimeoutRef: React.MutableRefObject<number | null>;
  saveCurrentConversationRef: React.MutableRefObject<(() => Promise<void>) | null>;
}

function messageHasVisibleContent(message: Message): boolean {
  return Boolean(
    message.content?.trim() ||
      message.thinking?.trim() ||
      message.rawContent?.trim() ||
      message.rawThinking?.trim() ||
      (message.tool_calls && message.tool_calls.length > 0)
  );
}

export function finalizeStoppedMessage(prev: Message[], messageId: string): Message[] {
  const index = prev.findIndex((message) => message.id === messageId);
  if (index === -1) return prev;

  const message = prev[index];
  if (!messageHasVisibleContent(message)) {
    return prev.filter((item) => item.id !== messageId);
  }

  const updated = [...prev];
  updated[index] = {
    ...updated[index],
    isStreaming: false,
    thinkingEndedAt: updated[index].thinkingEndedAt ?? Date.now(),
    endTime: updated[index].endTime ?? Date.now(),
  };
  return updated;
}

export function useStopHandler({
  currentAssistantMessageId,
  setCurrentAssistantMessageId,
  setIsLoading,
  isStopping,
  setIsStopping,
  isExecutingToolsRef,
  toolAbortControllerRef,
  canceledMessageIdsRef,
  ownedStreamMessageIdsRef,
  flushQueuedChunksForMessage,
  cancelStreamCompletion,
  setMessages,
  setError,
  autoSaveTimeoutRef,
  saveCurrentConversationRef,
}: UseStopHandlerOptions) {
  const stopTimeoutRef = useRef<number | null>(null);

  const scheduleSave = () => {
    if (autoSaveTimeoutRef.current != null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      void saveCurrentConversationRef.current?.();
    }, 500);
  };

  const handleStop = async () => {
    if (!currentAssistantMessageId) {
      console.warn('停止操作: 没有活动的消息ID');
      return;
    }

    if (isStopping) {
      console.warn('停止操作: 已经在停止中，忽略重复请求');
      return;
    }

    const messageId = currentAssistantMessageId;
    logDebug('停止操作: 开始停止消息 ' + messageId, 'ChatPanel');

    cancelStreamCompletion(messageId);
    flushQueuedChunksForMessage(messageId);

    canceledMessageIdsRef.current.add(messageId);
    ownedStreamMessageIdsRef.current.delete(messageId);

    setIsStopping(true);

    if (toolAbortControllerRef.current) {
      logDebug('停止操作: 中止工具执行', 'ChatPanel');
      toolAbortControllerRef.current.abort();
      toolAbortControllerRef.current = null;
    }

    const timeoutId = window.setTimeout(() => {
      console.warn(`停止操作: 超时 (5秒)，强制清理状态 ${messageId}`);
      setIsLoading(false);
      setIsStopping(false);
      isExecutingToolsRef.current = false;
      toolAbortControllerRef.current = null;
      setCurrentAssistantMessageId(null);

      setMessages((prev) => finalizeStoppedMessage(prev, messageId));

      setError('停止操作超时，已强制终止');
      scheduleSave();
    }, 5000);
    stopTimeoutRef.current = timeoutId;

    try {
      await invoke('cancel_ai_chat', { messageId });

      window.clearTimeout(timeoutId);
      stopTimeoutRef.current = null;
      logDebug('停止操作: 成功停止消息 ' + messageId, 'ChatPanel');

      setIsLoading(false);
      setIsStopping(false);
      isExecutingToolsRef.current = false;

      setMessages((prev) => finalizeStoppedMessage(prev, messageId));

      setCurrentAssistantMessageId(null);

      setError(null);
      scheduleSave();
    } catch (error) {
      window.clearTimeout(timeoutId);
      stopTimeoutRef.current = null;
      console.error('停止操作: 失败 ' + messageId, error);

      setIsLoading(false);
      setIsStopping(false);
      isExecutingToolsRef.current = false;
      toolAbortControllerRef.current = null;
      setCurrentAssistantMessageId(null);

      setMessages((prev) => finalizeStoppedMessage(prev, messageId));

      setError(`停止失败: ${error}`);
      scheduleSave();
    }
  };

  return {
    handleStop,
    stopTimeoutRef,
  };
}
