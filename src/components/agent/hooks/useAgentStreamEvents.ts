import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { logDebug } from '../../../utils/errorHandling';
import { isManualCancelError, finalizeThinkingMessage } from '../utils';
import { finalizeStreamMessage } from '../../../utils/streamChunkSeparation';
import { resolveStreamCompletionToolCalls } from '../../../features/agent-engine/streamCompletionToolCalls';
import {
  appendExecutedToolToMessage,
  flushQueuedChunksForMessageIfNeeded,
} from './agentStreamEventHelpers';
import { updateAgentConversationById, updateAgentMessageById } from './agentConversationUpdates';
import { calibrateTokenEstimation } from '../../../utils/contextBudget';
import { useUsageStore } from '../../../stores/useUsageStore';
import type {
  AgentConversationState,
  StreamChunkPayload,
  StreamCompletePayload,
  StreamErrorPayload,
  StreamMeta,
  StreamChunkQueueItem,
  ChatMessage,
} from '../../../types/chat';
import type { ToolCall } from '../../../features/agent-engine';
import type { AIProvider } from '../../../utils/agentPersistence';
import type { AgentRuntimeSnapshot } from '../utils';
import { isBuiltinProtocol, resolveBuiltinStreamError } from '../../../utils/builtinGateway';
import { useBuiltinGatewayStore } from '../../../stores/useBuiltinGatewayStore';

/** Payload for the ai-provider-switched event emitted by the Rust backend. */
interface ProviderSwitchedPayload {
  message_id: string;
  from_provider: string;
  from_model: string;
  to_provider: string;
  to_model: string;
}

function stripLegacyAutoRoutingChunk(text: string): string {
  return text.replace(/^🔄 自动路由：[^\n]*\n+/u, '');
}

export interface UseAgentStreamEventsOptions {
  streamSpeed: 'fast' | 'normal' | 'slow';
  enqueueStreamChunk: (item: StreamChunkQueueItem) => void;
  flushAllQueuedChunks: () => void;
  drainQueuedChunksFast: (onComplete?: () => void) => void;
  stopStreamChunkTimer: () => void;
  hasQueuedChunksForMessage: (messageId: string) => boolean;
  getKnownToolNames: () => string[];
  handleToolCallsRef: React.MutableRefObject<
    | ((
        toolCalls: ToolCall[],
        agentId: string,
        conversationId: string,
        messageId: string
      ) => Promise<void>)
    | null
  >;
  isStopRequested: (sessionKey: string) => boolean;
  clearTrackedStream: (messageId: string) => void;
  onSetConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
  onSetError: (msg: string | null) => void;
  /** Friendly message when built-in gateway returns 401 / auth_error during streaming. */
  builtinUnauthorizedMessage?: string;
  streamMetaByMessageIdRef: React.MutableRefObject<Record<string, StreamMeta>>;
  conversationStateRef: React.MutableRefObject<AgentConversationState>;
  agentRuntimeRef: React.MutableRefObject<AgentRuntimeSnapshot>;
}

function messageHasVisibleContent(message: ChatMessage): boolean {
  return Boolean(
    message.text?.trim() ||
    message.thinking?.trim() ||
    (message.tool_calls && message.tool_calls.length > 0)
  );
}

function stopStreamingMessageInConversation(
  state: AgentConversationState,
  conversationId: string,
  messageId: string,
  options: { removeIfEmpty: boolean }
): AgentConversationState {
  return updateAgentConversationById(state, conversationId, (conversation) => {
    const target = conversation.messages.find((message) => message.id === messageId);
    if (!target) {
      return conversation;
    }

    if (!messageHasVisibleContent(target) && options.removeIfEmpty) {
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
        return finalizeThinkingMessage({
          ...message,
          isStreaming: false,
          isProcessingTools: false,
          thinkingEndedAt: message.thinkingEndedAt ?? Date.now(),
        });
      }),
    };
  });
}

export function useAgentStreamEvents(options: UseAgentStreamEventsOptions) {
  const {
    streamSpeed,
    enqueueStreamChunk,
    flushAllQueuedChunks,
    drainQueuedChunksFast: _drainQueuedChunksFast,
    stopStreamChunkTimer: _stopStreamChunkTimer,
    hasQueuedChunksForMessage,
    getKnownToolNames,
    handleToolCallsRef,
    isStopRequested,
    clearTrackedStream,
    onSetConversationState,
    onSetError,
    builtinUnauthorizedMessage,
    streamMetaByMessageIdRef,
    conversationStateRef,
    agentRuntimeRef,
  } = options;

  const streamSpeedRef = useRef(streamSpeed);
  useEffect(() => {
    streamSpeedRef.current = streamSpeed;
  }, [streamSpeed]);

  const getKnownToolNamesRef = useRef(getKnownToolNames);
  useEffect(() => {
    getKnownToolNamesRef.current = getKnownToolNames;
  }, [getKnownToolNames]);

  useEffect(() => {
    const unlisten = listen<StreamChunkPayload>('ai-stream-chunk', (event) => {
      const { message_id, chunk, chunk_type } = event.payload;
      const streamMeta = streamMetaByMessageIdRef.current[message_id];
      if (!streamMeta) return;

      const isThinkingChunk = chunk_type === 'thinking';
      const isContentChunk = chunk_type === 'content' || chunk_type === 'delta';
      if (!isThinkingChunk && !isContentChunk) return;

      const normalizedChunk = isThinkingChunk ? chunk : stripLegacyAutoRoutingChunk(chunk);
      if (!isThinkingChunk && !normalizedChunk) return;

      enqueueStreamChunk({
        message_id,
        chunk: normalizedChunk,
        chunk_type: isThinkingChunk ? 'thinking' : 'content',
        agentId: streamMeta.agentId,
        conversationId: streamMeta.conversationId,
        sessionKey: streamMeta.sessionKey,
        chunkTime: Date.now(),
      });
    });

    const unlistenComplete = listen<StreamCompletePayload>('ai-stream-complete', (event) => {
      const { message_id, tool_calls, thinking_signature, usage } = event.payload;
      const streamMeta = streamMetaByMessageIdRef.current[message_id];
      if (!streamMeta) return;

      // 方法 11：用 API 返回的实际 input_tokens 校准前端的 estimateTokens 系数。
      // 估算当前会话的消息总 token 数，与实际值对比来调整系数。
      if (usage?.input_tokens && usage.input_tokens > 0) {
        const snapshot = conversationStateRef.current;
        const conv = snapshot.conversations.find((c) => c.id === streamMeta.conversationId);
        if (conv) {
          // 粗略估算发送的消息总 token 数（与发送时的估算方式一致）
          const estimatedTotal = conv.messages.reduce((sum, msg) => {
            const text = typeof msg.text === 'string' ? msg.text : '';
            // 简化估算：每条消息的文本 token + 4 开销
            const cjkChars = (
              text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []
            ).length;
            const nonCjkLen = text.length - cjkChars;
            return sum + 4 + cjkChars * 1.5 + nonCjkLen / 3.5;
          }, 0);
          if (estimatedTotal > 0) {
            calibrateTokenEstimation(estimatedTotal, usage.input_tokens);
          }
        }
      }

      // 方法 12：记录 cached/uncached token 统计（日志输出，供调试和后续 UI 展示）
      if (usage) {
        const cached =
          (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        const uncached = (usage.input_tokens ?? 0) - cached;
        if (cached > 0 || usage.cache_creation_input_tokens) {
          logDebug(
            `[stream] Token usage: input=${usage.input_tokens ?? 0}, output=${usage.output_tokens ?? 0}, ` +
              `cache_read=${usage.cache_read_input_tokens ?? 0}, cache_write=${usage.cache_creation_input_tokens ?? 0}, ` +
              `uncached=${uncached > 0 ? uncached : 0}`
          );
        }
      }

      // 用量/成本追踪：把真实 API usage 累加到 UsageStore（按会话 + 按模型粒度）
      if (usage) {
        useUsageStore.getState().addUsage({
          sessionKey: streamMeta.conversationId,
          provider: event.payload.provider,
          model: event.payload.model,
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheRead: usage.cache_read_input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
        });
      }

      const targetConversationId = streamMeta.conversationId;
      const targetAgentId = streamMeta.agentId;
      const savedMessageId = message_id;
      const backendToolCalls = tool_calls && tool_calls.length > 0 ? tool_calls : undefined;

      const finalizeCompletion = () => {
        const knownToolNames = getKnownToolNamesRef.current();
        const snapshot = conversationStateRef.current;
        const snapshotConversation = snapshot.conversations.find(
          (conv) => conv.id === targetConversationId
        );
        const snapshotMessage = snapshotConversation?.messages.find((msg) => msg.id === message_id);
        const snapshotMessageText =
          typeof snapshotMessage?.text === 'string' ? snapshotMessage.text : '';
        const resolution = resolveStreamCompletionToolCalls(
          backendToolCalls,
          snapshotMessageText,
          knownToolNames
        );
        const callsToExecute = resolution.toolCalls;

        onSetConversationState((prev) =>
          updateAgentMessageById(prev, targetConversationId, message_id, (msg) => {
            const updates: Partial<typeof msg> = {
              isStreaming: false,
              isProcessingTools: false,
            };

            if (resolution.toolCalls && resolution.toolCalls.length > 0) {
              updates.tool_calls = resolution.toolCalls;
              logDebug(
                '从流式完成事件中解析到工具调用: ' + JSON.stringify(resolution.toolCalls),
                'Agent'
              );
            }

            if (resolution.cleanedText !== undefined && resolution.cleanedText !== msg.text) {
              updates.text = resolution.cleanedText;
            }

            if (thinking_signature) {
              updates.thinkingSignature = thinking_signature;
            }
            if (msg.thinking && !msg.thinkingEndedAt) {
              updates.thinkingEndedAt = msg.firstContentTime ?? Date.now();
            }
            if (msg.thinking) {
              updates.isThinking = false;
            }

            const finalizedMessage = { ...msg, ...updates };
            const separated = finalizeStreamMessage({
              rawContent: finalizedMessage.rawContent ?? finalizedMessage.text ?? '',
              rawThinking: finalizedMessage.rawThinking ?? finalizedMessage.thinking ?? '',
              streamContent: finalizedMessage.text,
              streamThinking: finalizedMessage.thinking,
              receivedThinkingChunks: finalizedMessage.receivedThinkingChunks,
              hasToolCalls: Boolean(
                finalizedMessage.tool_calls && finalizedMessage.tool_calls.length > 0
              ),
            });
            finalizedMessage.text = separated.content;
            finalizedMessage.thinking = separated.thinking;
            return finalizeThinkingMessage(finalizedMessage);
          })
        );

        const realCalls = callsToExecute ?? [];
        if (isStopRequested(streamMeta.sessionKey)) {
          clearTrackedStream(savedMessageId);
          return;
        }
        if (realCalls.length > 0) {
          logDebug('检测到工具调用: ' + JSON.stringify(realCalls), 'Agent');
          if (handleToolCallsRef.current) {
            void handleToolCallsRef.current(
              realCalls,
              targetAgentId,
              targetConversationId,
              savedMessageId
            );
          }
          return;
        }

        clearTrackedStream(savedMessageId);
      };

      if (streamSpeedRef.current !== 'fast' && hasQueuedChunksForMessage(message_id)) {
        // Ensure deterministic completion even when RAF is throttled in tests/background tabs.
        flushAllQueuedChunks();
      }

      finalizeCompletion();
    });

    const mapStreamError = (errorMsg: string): string => {
      if (!builtinUnauthorizedMessage) return errorMsg;
      const { message, unauthorized } = resolveBuiltinStreamError(
        errorMsg,
        builtinUnauthorizedMessage,
        { treatAsBuiltin: isBuiltinProtocol(agentRuntimeRef.current.provider) }
      );
      if (unauthorized) {
        useBuiltinGatewayStore.setState({ error: 'UNAUTHORIZED', status: 'error' });
      }
      return message;
    };

    const finalizeStreamError = (effectiveMessageId: string, errorMsg: string) => {
      const streamMeta = streamMetaByMessageIdRef.current[effectiveMessageId];
      const manualCancel = isManualCancelError(errorMsg);
      const displayError = manualCancel ? errorMsg : mapStreamError(errorMsg);

      if (!streamMeta) {
        if (!manualCancel) {
          onSetError(displayError);
        }
        clearTrackedStream(effectiveMessageId);
        return;
      }

      const targetConversationId = streamMeta.conversationId;
      onSetConversationState((prev) =>
        stopStreamingMessageInConversation(prev, targetConversationId, effectiveMessageId, {
          removeIfEmpty: manualCancel,
        })
      );

      if (!manualCancel) {
        onSetError(displayError);
      }

      clearTrackedStream(effectiveMessageId);
    };

    const unlistenError = listen<StreamErrorPayload>('ai-stream-error', (event) => {
      const { message_id, error: errorMsg } = event.payload;
      let effectiveMessageId = message_id;
      if (!effectiveMessageId) {
        const activeMessageIds = Object.keys(streamMetaByMessageIdRef.current);
        if (activeMessageIds.length === 1) {
          [effectiveMessageId] = activeMessageIds;
        }
      }

      if (!effectiveMessageId) {
        if (!isManualCancelError(errorMsg)) {
          onSetError(errorMsg);
        }
        return;
      }

      finalizeStreamError(effectiveMessageId, errorMsg);
    });

    const unlistenCancelled = listen<{ message_id: string }>('ai-stream-cancelled', (event) => {
      const { message_id } = event.payload;
      if (!message_id) return;
      finalizeStreamError(message_id, 'manually canceled');
    });

    const unlistenToolExecuted = listen<{
      message_id: string;
      tool_name: string;
      tool_call_id: string;
      result_preview: string;
      success: boolean;
      round: number;
      total_rounds_so_far: number;
    }>('ai-tool-executed', (event) => {
      const {
        message_id,
        tool_name,
        tool_call_id,
        result_preview,
        success,
        round,
        total_rounds_so_far,
      } = event.payload;
      const streamMeta = streamMetaByMessageIdRef.current[message_id];
      if (!streamMeta) return;

      const targetConversationId = streamMeta.conversationId;
      flushQueuedChunksForMessageIfNeeded(
        message_id,
        hasQueuedChunksForMessage,
        flushAllQueuedChunks
      );

      onSetConversationState((prev) =>
        updateAgentMessageById(prev, targetConversationId, message_id, (msg) => {
          const newExecutedTool = {
            tool_name,
            tool_call_id,
            result_preview,
            success,
            round,
            total_rounds_so_far,
          };
          return appendExecutedToolToMessage(msg, newExecutedTool);
        })
      );
    });

    const unlistenOrchestrationRound = listen<{
      message_id: string;
      round: number;
      tool_count: number;
    }>('ai-orchestration-round', (event) => {
      const { message_id } = event.payload;
      const streamMeta = streamMetaByMessageIdRef.current[message_id];
      if (!streamMeta) return;

      flushQueuedChunksForMessageIfNeeded(
        message_id,
        hasQueuedChunksForMessage,
        flushAllQueuedChunks
      );
    });

    const unlistenProviderSwitched = listen<ProviderSwitchedPayload>(
      'ai-provider-switched',
      (event) => {
        const { message_id, from_provider, from_model, to_provider, to_model } = event.payload;

        const streamMeta = streamMetaByMessageIdRef.current[message_id];
        if (!streamMeta) return;
        if (agentRuntimeRef.current.routingMode !== 'auto') return;

        onSetConversationState((prev) =>
          updateAgentConversationById(prev, streamMeta.conversationId, (conversation) => {
            const alreadyNotified = conversation.messages.some(
              (message) =>
                message.uiNotice?.type === 'provider-switch' &&
                message.uiNotice.fromProvider === from_provider &&
                message.uiNotice.fromModel === from_model &&
                message.uiNotice.toProvider === to_provider &&
                message.uiNotice.toModel === to_model
            );
            if (alreadyNotified) {
              return conversation;
            }

            const noticeMessage: ChatMessage = {
              id: `provider-switch-${message_id}-${Date.now()}`,
              role: 'assistant',
              text: '',
              createdAt: Date.now(),
              uiNotice: {
                type: 'provider-switch',
                fromProvider: from_provider,
                fromModel: from_model,
                toProvider: to_provider,
                toModel: to_model,
              },
            };

            const anchorIndex = conversation.messages.findIndex(
              (message) => message.id === message_id
            );
            const messages =
              anchorIndex >= 0
                ? [
                    ...conversation.messages.slice(0, anchorIndex),
                    noticeMessage,
                    ...conversation.messages.slice(anchorIndex),
                  ]
                : [...conversation.messages, noticeMessage];

            return {
              ...conversation,
              messages,
            };
          })
        );

        logDebug(
          `[AutoRouting] Provider switched: ${from_provider}/${from_model} -> ${to_provider}/${to_model}`
        );

        agentRuntimeRef.current = {
          ...agentRuntimeRef.current,
          provider: to_provider as AIProvider,
          model: to_model,
          routingMode: 'auto',
        };
      }
    );

    return () => {
      unlisten.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenCancelled.then((fn) => fn());
      unlistenToolExecuted.then((fn) => fn());
      unlistenOrchestrationRound.then((fn) => fn());
      unlistenProviderSwitched.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
