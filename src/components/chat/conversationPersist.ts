import type { CompactState } from '../../types/chat';
import { exportPlanForSave } from '../../features/agent-engine/planStore';
import type { Conversation, Message } from './types';

export function mapMessageToConversationMessage(m: Message) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    attachments: m.attachments,
    tool_calls: m.tool_calls,
    tool_call_id: m.tool_call_id,
    tool_name: m.tool_name,
    tool_args: m.tool_args,
    thinking: m.thinking,
    tokens: m.tokens
      ? { input: Math.floor(m.tokens / 2), output: Math.ceil(m.tokens / 2) }
      : undefined,
    timestamp: (() => {
      const d = new Date(m.timestamp ?? Date.now());
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    })(),
    startTime: m.startTime,
    firstChunkTime: m.firstChunkTime,
    firstContentTime: m.firstContentTime,
    endTime: m.endTime,
    thinkingStartedAt: m.thinkingStartedAt,
    thinkingEndedAt: m.thinkingEndedAt,
    compactBoundary: m.compactBoundary,
    compactSummary: m.compactSummary,
    compactMetadata: m.compactMetadata,
    ...(m.slashCommand ? { slashCommand: m.slashCommand } : {}),
  };
}

export function buildConversationPayload(
  conv: Conversation,
  messages: Message[],
  compactState?: CompactState | null,
  pendingChanges?: Conversation['pendingChanges'],
): Conversation {
  const planDocument = exportPlanForSave(conv.id) ?? null;
  return {
    ...conv,
    messages: messages.map(mapMessageToConversationMessage),
    compactState: compactState ?? conv.compactState,
    pendingChanges: pendingChanges ?? conv.pendingChanges,
    planDocument,
    last_used_at: new Date().toISOString(),
  };
}
