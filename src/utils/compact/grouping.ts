/**
 * API round grouping for context compaction.
 * @module compact/grouping
 */

import type { CompactableMessage } from './types';

export interface ApiRound {
  startIndex: number;
  endIndex: number;
  messageIndices: number[];
}

function isCompactArtifact(msg: CompactableMessage): boolean {
  return Boolean(msg.compactBoundary || msg.compactSummary || msg.uiNotice);
}

function isRoundStart(msg: CompactableMessage): boolean {
  return msg.role === 'user' && !msg.compactSummary && !msg.compactBoundary;
}

/**
 * Group messages into API rounds (user → assistant + tools).
 * Skips compact boundary/summary artifacts and streaming placeholders.
 */
export function groupMessagesByApiRound(messages: CompactableMessage[]): ApiRound[] {
  const rounds: ApiRound[] = [];
  let current: number[] | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.isStreaming || isCompactArtifact(msg)) {
      continue;
    }

    if (isRoundStart(msg)) {
      if (current && current.length > 0) {
        rounds.push({
          startIndex: current[0],
          endIndex: current[current.length - 1],
          messageIndices: current,
        });
      }
      current = [i];
      continue;
    }

    if (current) {
      current.push(i);
    }
  }

  if (current && current.length > 0) {
    rounds.push({
      startIndex: current[0],
      endIndex: current[current.length - 1],
      messageIndices: current,
    });
  }

  return rounds;
}

export interface SplitByRetention {
  prefixIndices: number[];
  keepIndices: number[];
  prefixStart: number;
  prefixEnd: number;
  keepStart: number;
}

/**
 * Split message indices into compressible prefix vs retained suffix by round count.
 */
export function splitByRoundRetention(
  messages: CompactableMessage[],
  keepLastRounds: number,
): SplitByRetention | null {
  const rounds = groupMessagesByApiRound(messages);
  if (rounds.length <= keepLastRounds) {
    return null;
  }

  const keepRounds = rounds.slice(-keepLastRounds);
  const compressRounds = rounds.slice(0, rounds.length - keepLastRounds);

  const prefixIndices = compressRounds.flatMap((r) => r.messageIndices);
  const keepIndices = keepRounds.flatMap((r) => r.messageIndices);

  if (prefixIndices.length === 0 || keepIndices.length === 0) {
    return null;
  }

  return {
    prefixIndices,
    keepIndices,
    prefixStart: prefixIndices[0],
    prefixEnd: prefixIndices[prefixIndices.length - 1],
    keepStart: keepIndices[0],
  };
}

/**
 * Split by raw message count (reactive path).
 */
export function splitByMessageCountRetention(
  messages: CompactableMessage[],
  keepCount: number,
): SplitByRetention | null {
  const eligible: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.isStreaming || isCompactArtifact(msg)) continue;
    eligible.push(i);
  }

  if (eligible.length <= keepCount) {
    return null;
  }

  const keepIndices = eligible.slice(-keepCount);
  const prefixIndices = eligible.slice(0, eligible.length - keepCount);

  if (prefixIndices.length === 0) {
    return null;
  }

  return {
    prefixIndices,
    keepIndices,
    prefixStart: prefixIndices[0],
    prefixEnd: prefixIndices[prefixIndices.length - 1],
    keepStart: keepIndices[0],
  };
}
