/**
 * Micro-compaction: truncate tool result bodies without LLM.
 * Tool-result micro-compaction is disabled so handler output stays intact in history.
 * @module compact/microCompact
 */

import { estimateMessageTokens } from '../contextBudget';
import { toBudgetMessage } from './budgetMessage';
import type { CompactableMessage } from './types';

/**
 * Micro-compact tool messages. Currently a no-op to preserve full tool returns.
 */
export function microCompactMessages<T extends CompactableMessage>(
  messages: T[]
): {
  messages: T[];
  changed: boolean;
  tokensSaved: number;
} {
  return { messages, changed: false, tokensSaved: 0 };
}

export function estimateMessagesTokens(messages: CompactableMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(toBudgetMessage(m)), 0);
}
