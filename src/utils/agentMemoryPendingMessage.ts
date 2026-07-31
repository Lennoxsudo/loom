import type { ChatMessage } from '../types/chat';
import { formatAgentMemoryStagedOutput } from './agentMemoryPendingUi';

/** Build a tool-result card message for a staged Agent Memory write (content-area approval). */
export function buildAgentMemoryPendingToolMessage(options: {
  pendingId: string;
  target: 'user' | 'memory';
  content: string;
  reason?: string;
  conversationId?: string;
}): ChatMessage {
  const text = formatAgentMemoryStagedOutput({
    pendingId: options.pendingId,
    action: 'add',
    target: options.target,
    content: options.content,
  });

  return {
    id: `agent_memory_pending_${options.pendingId}`,
    role: 'tool',
    text,
    tool_call_id: `agent_memory_pending_${options.pendingId}`,
    tool_name: 'agent_memory',
    tool_args: {
      action: 'add',
      target: options.target,
      content: options.content,
      agentMemoryPendingId: options.pendingId,
      reason: options.reason,
      conversationId: options.conversationId,
    },
    approvalStatus: 'pending',
    approvalSummary: {
      type: 'agent_memory',
      toolName: 'agent_memory',
      label: 'Agent Memory',
      detail: options.content,
    },
    createdAt: Date.now(),
    isStreaming: false,
  };
}
