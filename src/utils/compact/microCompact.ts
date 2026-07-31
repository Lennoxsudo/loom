/**
 * Micro-compaction: truncate tool result bodies without LLM.
 * Intentionally a no-op: full tool returns are preserved for the UI/cache prefix.
 * Disk/context growth is controlled by pressure-gated {@link agePersistedChatToolMessages}
 * on persist paths instead.
 * @module compact/microCompact
 */

import { estimateMessageTokens } from '../contextBudget';
import { toBudgetMessage } from './budgetMessage';
import type { CompactableMessage } from './types';

/**
 * Micro-compact tool messages. Currently a no-op; see module note above.
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
