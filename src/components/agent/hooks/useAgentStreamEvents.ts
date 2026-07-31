import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { logDebug } from '../../../utils/errorHandling';
import { isManualCancelError } from '../utils';
import { finalizeStreamMessage } from '../../../utils/streamChunkSeparation';
import { resolveStreamCompletionToolCalls } from '../../../features/agent-engine/streamCompletionToolCalls';
import {
  appendExecutedToolToMessage,
  flushQueuedChunksForMessageIfNeeded,
} from './agentStreamEventHelpers';
import { updateAgentConversationById, updateAgentMessageById } from './agentConversationUpdates';
import {
  calibrateTokenEstimation,
  consumeRequestTokenEstimate,
} from '../../../utils/contextBudget';
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
import { runAgentMemoryReview } from '../../../utils/agentMemoryReview';
import { buildAgentMemoryPendingToolMessage } from '../../../utils/agentMemoryPendingMessage';
import { useSettingsStore } from '../../../stores/useSettingsStore';

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
  flushQueuedChunksForMessage: (messageId: string) => void;
  drainQueuedChunksFast: (onComplete?: () => void) => void;
  stopStreamChunkTimer: () => void;
  hasQueuedChunksForMessage: (messageId: string) => boolean;
  /** Chat-aligned completion quiescence coordinator */
  streamCompletionCoordinator: {
    noteChunk: (messageId: string) => boolean;
    complete: (messageId: string, finalize: () => void) => void;
    cancel: (messageId: string) => void;
  };
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
        return {
          ...message,
          isStreaming: false,
          isProcessingTools: false,
          endTime: message.endTime ?? Date.now(),
          isThinking: false,
          thinkingEndedAt: message.thinking
            ? (message.thinkingEndedAt ?? message.firstContentTime ?? Date.now())
            : message.thinkingEndedAt,
          thinkingStartedAt: message.thinking
            ? (message.thinkingStartedAt ?? message.firstChunkTime ?? message.createdAt)
            : message.thinkingStartedAt,
        };
      }),
    };
  });
}

export function useAgentStreamEvents(options: UseAgentStreamEventsOptions) {
  const {
    streamSpeed,
    enqueueStreamChunk,
    flushAllQueuedChunks: _flushAllQueuedChunks,
    flushQueuedChunksForMessage,
    drainQueuedChunksFast: _drainQueuedChunksFast,
    stopStreamChunkTimer: _stopStreamChunkTimer,
    hasQueuedChunksForMessage,
    streamCompletionCoordinator,
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

  // 经历过后端编排的消息 id：其 usage 为多轮累积值，与单次请求口径不可对齐，校准时跳过
  const orchestratedMessageIdsRef = useRef<Set<string>>(new Set());

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

      streamCompletionCoordinator.noteChunk(message_id);
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

      // 方法 11：用 API 返回的实际 token 数校准前端的 estimateTokens 系数。
      // 估算值在发送时按同一份 payload（消息 + 工具定义）记录；实际值取总输入
      // （Anthropic 的 input_tokens 不含缓存部分，需加回 cache_read / cache_creation）。
      // 后端编排多轮累积的 usage 与单次请求口径不可对齐，跳过校准。
      const pendingEstimate = consumeRequestTokenEstimate(message_id);
      if (
        pendingEstimate &&
        pendingEstimate.estimatedTokens > 0 &&
        usage?.input_tokens &&
        usage.input_tokens > 0 &&
        !orchestratedMessageIdsRef.current.has(message_id)
      ) {
        const actualTotal =
          usage.input_tokens +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        calibrateTokenEstimation(
          pendingEstimate.estimatedTokens,
          actualTotal,
          pendingEstimate.calibrationKey
        );
      }
      orchestratedMessageIdsRef.current.delete(message_id);

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
        const conversationTitle = conversationStateRef.current.conversations.find(
          (conv) => conv.id === streamMeta.conversationId
        )?.title;
        useUsageStore.getState().addUsage({
          sessionKey: streamMeta.conversationId,
          sessionTitle: conversationTitle,
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
            const endTime = Date.now();
            let nextText = msg.text;
            if (resolution.cleanedText !== undefined && resolution.cleanedText !== msg.text) {
              nextText = resolution.cleanedText;
            }

            const separated = finalizeStreamMessage({
              rawContent: msg.rawContent ?? nextText ?? '',
              rawThinking: msg.rawThinking ?? msg.thinking ?? '',
              streamContent: nextText,
              streamThinking: msg.thinking,
              receivedThinkingChunks: msg.receivedThinkingChunks,
              hasToolCalls: Boolean(resolution.toolCalls && resolution.toolCalls.length > 0),
            });

            const finalized: typeof msg = {
              ...msg,
              text: separated.content,
              thinking: separated.thinking,
              isStreaming: false,
              isProcessingTools: false,
              endTime,
              isThinking: false,
            };

            if (resolution.toolCalls && resolution.toolCalls.length > 0) {
              finalized.tool_calls = resolution.toolCalls;
              logDebug(
                '从流式完成事件中解析到工具调用: ' + JSON.stringify(resolution.toolCalls),
                'Agent'
              );
            }

            if (thinking_signature) {
              finalized.thinkingSignature = thinking_signature;
            }

            // Match ChatPanel finalizeCompletion thinking timestamps.
            if (finalized.thinking) {
              if (!finalized.thinkingStartedAt) {
                finalized.thinkingStartedAt =
                  finalized.firstChunkTime ?? finalized.createdAt ?? endTime;
              }
              if (!finalized.thinkingEndedAt) {
                finalized.thinkingEndedAt = finalized.firstContentTime ?? endTime;
              }
            }

            return finalized;
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

        if (useSettingsStore.getState().enableAgentMemoryReview) {
          const conv = conversationStateRef.current.conversations.find(
            (c) => c.id === targetConversationId
          );
          void runAgentMemoryReview({
            conversationId: targetConversationId,
            messages: conv?.messages ?? [],
          })
            .then((result) => {
              if (!result.stagedItems.length) return;
              onSetConversationState((prev) =>
                updateAgentConversationById(prev, targetConversationId, (c) => ({
                  ...c,
                  messages: [
                    ...c.messages,
                    ...result.stagedItems.map((item) =>
                      buildAgentMemoryPendingToolMessage({
                        pendingId: item.id,
                        target: item.target,
                        content: item.content,
                        reason: item.reason,
                        conversationId: targetConversationId,
                      })
                    ),
                  ],
                  updatedAt: Date.now(),
                }))
              );
            })
            .catch((err) => {
              console.warn('[agentMemoryReview] failed', err);
            });
        }
      };

      streamCompletionCoordinator.complete(message_id, finalizeCompletion);
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

      orchestratedMessageIdsRef.current.delete(effectiveMessageId);
      finalizeStreamError(effectiveMessageId, errorMsg);
    });

    const unlistenCancelled = listen<{ message_id: string }>('ai-stream-cancelled', (event) => {
      const { message_id } = event.payload;
      if (!message_id) return;
      orchestratedMessageIdsRef.current.delete(message_id);
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
        flushQueuedChunksForMessage
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

      orchestratedMessageIdsRef.current.add(message_id);

      flushQueuedChunksForMessageIfNeeded(
        message_id,
        hasQueuedChunksForMessage,
        flushQueuedChunksForMessage
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
