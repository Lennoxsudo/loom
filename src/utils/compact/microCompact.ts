/**
 * Micro-compaction: truncate tool result bodies without LLM.
 * @module compact/microCompact
 */

import { estimateMessageTokens } from '../contextBudget';
import { toBudgetMessage } from './budgetMessage';
import {
  TOOL_RESULT_AGING_KEEP_COUNT,
  TOOL_RESULT_SUMMARY_MAX_CHARS,
  TOOL_RESULT_AGED_SUFFIX,
  isAgedToolResultText,
} from '../toolResultAging';
import type { CompactableMessage } from './types';

const MICRO_COMPACT_MIN_CHARS = 800;

function readMessageText(msg: CompactableMessage): string {
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  return '';
}

function writeMessageText<T extends CompactableMessage>(msg: T, text: string): T {
  if ('text' in msg) {
    return { ...msg, text };
  }
  if ('content' in msg) {
    return { ...msg, content: text };
  }
  return { ...msg, text };
}

function microCompactToolText(text: string): string {
  if (!text || text.length <= MICRO_COMPACT_MIN_CHARS || isAgedToolResultText(text)) {
    return text;
  }
  return text.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS) + TOOL_RESULT_AGED_SUFFIX;
}

/**
 * Apply micro-compaction to tool messages (keep last N tool results intact).
 */
export function microCompactMessages<T extends CompactableMessage>(
  messages: T[]
): {
  messages: T[];
  changed: boolean;
  tokensSaved: number;
} {
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') {
      toolIndices.push(i);
    }
  }

  if (toolIndices.length <= TOOL_RESULT_AGING_KEEP_COUNT) {
    return { messages, changed: false, tokensSaved: 0 };
  }

  const toCompact = new Set(
    toolIndices.slice(0, toolIndices.length - TOOL_RESULT_AGING_KEEP_COUNT)
  );
  let changed = false;
  let tokensSaved = 0;
  const next = messages.map((msg, i) => {
    if (!toCompact.has(i)) return msg;
    const original = readMessageText(msg);
    const compacted = microCompactToolText(original);
    if (compacted === original) return msg;
    changed = true;
    tokensSaved +=
      estimateMessageTokens(toBudgetMessage(msg)) -
      estimateMessageTokens(toBudgetMessage(writeMessageText(msg, compacted)));
    return writeMessageText(msg, compacted);
  });

  return { messages: next, changed, tokensSaved };
}

export function estimateMessagesTokens(messages: CompactableMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(toBudgetMessage(m)), 0);
}
