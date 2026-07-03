/**
 * Core compact conversation orchestration — three-path priority.
 * @module compact/compactConversation
 */

import {
  splitByMessageCountRetention,
  splitByRoundRetention,
} from './grouping';
import { microCompactMessages, estimateMessagesTokens } from './microCompact';
import { generateCompactSummary } from './sessionMemoryCompact';
import {
  buildPostCompactMessages,
  evaluateCompactResult,
} from './compact';
import {
  DEFAULT_KEEP_ROUNDS,
  REACTIVE_KEEP_MESSAGE_COUNT,
  type CompactConversationOptions,
  type CompactPath,
  type CompactResult,
  type CompactableMessage,
} from './types';

async function tryCompactPath<T extends CompactableMessage>(
  path: CompactPath,
  opts: CompactConversationOptions & { messages: T[] },
): Promise<CompactResult<T> | null> {
  const {
    messages,
    budgetTokens,
    provider,
    model,
    profileId,
    compactType = 'auto',
    keepLastRounds = DEFAULT_KEEP_ROUNDS,
    reactiveKeepMessageCount = REACTIVE_KEEP_MESSAGE_COUNT,
  } = opts;

  const originalTokens = estimateMessagesTokens(messages);

  let split;
  let promptMode: 'base' | 'partial' | 'partial_up_to' = 'base';

  if (path === 'reactive') {
    split = splitByMessageCountRetention(messages, reactiveKeepMessageCount);
    promptMode = 'partial';
  } else {
    split = splitByRoundRetention(messages, keepLastRounds);
    if (path === 'traditional' && !split) {
      const micro = microCompactMessages(messages);
      const microTokens = estimateMessagesTokens(micro.messages);
      if (micro.changed && microTokens <= budgetTokens) {
        return evaluateCompactResult(micro.messages, originalTokens, true, path, null);
      }
      return null;
    }
    if (path === 'session_memory') {
      promptMode = 'base';
    }
  }

  if (!split) {
    return null;
  }

  const prefixMessages = split.prefixIndices.map((i) => messages[i]);
  if (prefixMessages.length === 0) {
    return null;
  }

  const { summaryText } = await generateCompactSummary({
    prefixMessages,
    split,
    provider,
    model,
    profileId,
    promptMode,
  });

  const { messages: compactedMessages, metadata } = buildPostCompactMessages({
    messages,
    split,
    summaryText,
    compactType,
    compactPath: path,
  });

  const compressedTokens = estimateMessagesTokens(compactedMessages);
  if (compressedTokens > budgetTokens) {
    return null;
  }

  return evaluateCompactResult(compactedMessages, originalTokens, true, path, metadata);
}

/**
 * Try three compaction paths in priority order.
 */
export async function compactConversation<T extends CompactableMessage>(
  opts: CompactConversationOptions & { messages: T[] },
): Promise<CompactResult<T>> {
  const originalTokens = estimateMessagesTokens(opts.messages);

  const paths: CompactPath[] = ['session_memory', 'reactive', 'traditional'];
  for (const path of paths) {
    const result = await tryCompactPath(path, opts);
    if (result?.compacted) {
      return result;
    }
  }

  // Path C fallback: microCompact only
  const micro = microCompactMessages(opts.messages);
  if (micro.changed) {
    return evaluateCompactResult(micro.messages, originalTokens, true, 'traditional', null);
  }

  return evaluateCompactResult(opts.messages, originalTokens, false, null, null);
}
