/**
 * Auto-compact threshold and turn monitoring.
 * @module compact/autoCompact
 */

import {
  AUTO_COMPRESS_THRESHOLD,
  DEFAULT_CONTEXT_WINDOW,
  estimateMessageTokens,
  estimateToolsTokens,
} from '../contextBudget';
import {
  type AutoCompactCheckOptions,
  type CompactState,
  MIN_TURNS_BEFORE_RECOMPACT,
  RESERVE_TOKENS,
} from './types';
import { estimateMessagesTokens } from './microCompact';
import { toBudgetMessage } from './budgetMessage';
import type { CompactableMessage } from './types';

export function createInitialCompactState(): CompactState {
  return { turnsSincePreviousCompact: 0 };
}

export function incrementCompactTurns(state: CompactState | null | undefined): CompactState {
  const base = state ?? createInitialCompactState();
  return {
    ...base,
    turnsSincePreviousCompact: base.turnsSincePreviousCompact + 1,
  };
}

export function resetCompactTurns(state: CompactState | null | undefined): CompactState {
  const base = state ?? createInitialCompactState();
  return {
    ...base,
    turnsSincePreviousCompact: 0,
    lastCompactedAt: Date.now(),
  };
}

export function computeCompressionThreshold(opts: {
  maxContextTokens?: number;
  tools?: unknown;
  reserveTokens?: number;
}): number {
  const budget = opts.maxContextTokens ?? DEFAULT_CONTEXT_WINDOW;
  const toolTokens = estimateToolsTokens(opts.tools);
  const reserve = opts.reserveTokens ?? RESERVE_TOKENS;
  const messageBudget = budget - toolTokens - reserve;
  return Math.floor(messageBudget * AUTO_COMPRESS_THRESHOLD);
}

export function shouldAutoCompact(opts: AutoCompactCheckOptions): boolean {
  const { messages, compactState, tools, maxContextTokens, reserveTokens } = opts;
  const threshold = computeCompressionThreshold({
    maxContextTokens,
    tools,
    reserveTokens,
  });

  const totalTokens = estimateMessagesTokens(messages);
  if (totalTokens <= threshold) {
    return false;
  }

  const turns = compactState?.turnsSincePreviousCompact ?? 0;
  if (compactState?.lastCompactedAt && turns < MIN_TURNS_BEFORE_RECOMPACT) {
    return false;
  }

  return true;
}

export function isProtectedMessage(msg: CompactableMessage): boolean {
  return Boolean(
    msg.compactBoundary ||
      msg.compactSummary ||
      msg.uiNotice ||
      msg.isStreaming,
  );
}

export function estimateMessageListTokens(messages: CompactableMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(toBudgetMessage(m)), 0);
}
