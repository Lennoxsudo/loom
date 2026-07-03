import type { ChatMessage } from '../../../types/chat';

type ExecutedToolEntry = NonNullable<ChatMessage['executedTools']>[number];

/** Chat 对齐：ai-tool-executed 仅追加 executedTools，不改 thinking/stream 状态 */
export function appendExecutedToolToMessage<T extends Pick<ChatMessage, 'executedTools'>>(
  msg: T,
  tool: ExecutedToolEntry
): T {
  return {
    ...msg,
    executedTools: [...(msg.executedTools || []), tool],
  };
}

/** 工具/编排事件到达时，若思考块仍在计时则立即收尾 */
export function buildThinkingEndedPatch(
  msg: Pick<ChatMessage, 'thinking' | 'thinkingEndedAt'>,
  now = Date.now()
): Pick<ChatMessage, 'thinkingEndedAt' | 'isThinking'> | Record<string, never> {
  if (msg.thinking && !msg.thinkingEndedAt) {
    return { thinkingEndedAt: now, isThinking: false };
  }
  return {};
}

/** 工具事件生效前先排空该消息的节流队列（若仍有排队 chunk） */
export function flushQueuedChunksForMessageIfNeeded(
  messageId: string,
  hasQueuedChunksForMessage: (messageId: string) => boolean,
  flushAllQueuedChunks: () => void
): void {
  if (hasQueuedChunksForMessage(messageId)) {
    flushAllQueuedChunks();
  }
}
