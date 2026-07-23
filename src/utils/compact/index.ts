/**
 * Context compact module entry point.
 * @module compact
 */

export * from './types';
export * from './prompt';
export * from './grouping';
export * from './microCompact';
export * from './compact';
export * from './compactConversation';
export * from './autoCompact';
export * from './sessionMemoryCompact';

import { compactConversation } from './compactConversation';
import { shouldAutoCompact, resetCompactTurns } from './autoCompact';
import { computeCompressionThreshold } from './autoCompact';
import type { CompactableMessage, CompactResult, CompactState, CompactType } from './types';

export interface MaybeAutoCompactOptions<T extends CompactableMessage> {
  messages: T[];
  provider: string;
  model: string;
  profileId?: string;
  tools?: unknown;
  maxContextTokens?: number;
  reserveTokens?: number;
  compactState?: CompactState | null;
  compactType?: CompactType;
}

export interface MaybeAutoCompactResult<T extends CompactableMessage> {
  messages: T[];
  compacted: boolean;
  compactState: CompactState;
  result: CompactResult<T> | null;
}

/**
 * Check threshold and run compaction if needed. Returns updated messages + compact state.
 */
export async function maybeAutoCompactConversation<T extends CompactableMessage>(
  opts: MaybeAutoCompactOptions<T>
): Promise<MaybeAutoCompactResult<T>> {
  const {
    messages,
    provider,
    model,
    profileId,
    tools,
    maxContextTokens,
    reserveTokens,
    compactState,
    compactType = 'auto',
  } = opts;

  const budgetTokens = computeCompressionThreshold({
    maxContextTokens,
    tools,
    reserveTokens,
  });

  if (
    !shouldAutoCompact({
      messages,
      budgetTokens,
      tools,
      maxContextTokens,
      reserveTokens,
      compactState,
    })
  ) {
    return {
      messages,
      compacted: false,
      compactState: compactState ?? { turnsSincePreviousCompact: 0 },
      result: null,
    };
  }

  const result = await compactConversation({
    messages,
    budgetTokens,
    provider,
    model,
    profileId,
    compactType,
  });

  if (!result.compacted) {
    return {
      messages,
      compacted: false,
      compactState: compactState ?? { turnsSincePreviousCompact: 0 },
      result,
    };
  }

  return {
    messages: result.messages,
    compacted: true,
    compactState: resetCompactTurns(compactState),
    result,
  };
}
