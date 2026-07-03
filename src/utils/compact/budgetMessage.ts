import type { CompactableMessage } from './types';

export function toBudgetMessage(msg: CompactableMessage): { role: string; content: unknown } {
  return {
    role: msg.role,
    content: msg.text ?? msg.content ?? '',
    ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
  };
}
