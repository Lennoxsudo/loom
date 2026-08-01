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
import { shouldAutoCompact, resetCompactTurns, incrementCompactTurns } from './autoCompact';
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
  /**
   * 为 true 时不执行压缩（也不会触发 LLM 摘要等付费调用），
   * 用于 UI 用量统计等只读路径。
   */
  skipCompact?: boolean;
  /**
   * 用户回合计数：为 true 且此前已 compact 过时，未再次 compact 则
   * `turnsSincePreviousCompact + 1`，以便通过 MIN_TURNS_BEFORE_RECOMPACT 门闩。
   * 工具续跑 / 二次组装 / 只读统计应保持 false。
   */
  countTurn?: boolean;
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
    skipCompact = false,
    countTurn = false,
  } = opts;

  const budgetTokens = computeCompressionThreshold({
    maxContextTokens,
    tools,
    reserveTokens,
  });

  if (
    skipCompact ||
    !shouldAutoCompact({
      messages,
      budgetTokens,
      tools,
      maxContextTokens,
      reserveTokens,
      compactState,
    })
  ) {
    let nextState = compactState ?? { turnsSincePreviousCompact: 0 };
    if (!skipCompact && countTurn && nextState.lastCompactedAt) {
      nextState = incrementCompactTurns(nextState);
    }
    return {
      messages,
      compacted: false,
      compactState: nextState,
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
    let nextState = compactState ?? { turnsSincePreviousCompact: 0 };
    if (countTurn && nextState.lastCompactedAt) {
      nextState = incrementCompactTurns(nextState);
    }
    return {
      messages,
      compacted: false,
      compactState: nextState,
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
