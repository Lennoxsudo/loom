/**
 * Build post-compact message arrays with boundary + summary messages.
 * @module compact/compact
 */

import { estimateMessageTokens } from '../contextBudget';
import { toBudgetMessage } from './budgetMessage';
import type {
  CompactableMessage,
  CompactMetadata,
  CompactPath,
  CompactResult,
  CompactType,
} from './types';
import type { SplitByRetention } from './grouping';

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildPostCompactMessages<T extends CompactableMessage>(opts: {
  messages: T[];
  split: SplitByRetention;
  summaryText: string;
  compactType: CompactType;
  compactPath: CompactPath;
}): { messages: T[]; metadata: CompactMetadata } {
  const { messages, split, summaryText, compactType, compactPath } = opts;
  const prefixMessages = split.prefixIndices.map((i) => messages[i]);
  const keepMessages = split.keepIndices.map((i) => messages[i]);

  const originalMessageIds = prefixMessages.map((m) => m.id);
  const headMessageId = originalMessageIds[0] ?? createId('head');
  const tailMessageId = originalMessageIds[originalMessageIds.length - 1] ?? headMessageId;
  const anchorMessageId = keepMessages[0]?.id ?? tailMessageId;
  const boundaryId = createId('compact_boundary');
  const summaryId = createId('compact_summary');

  const metadata: CompactMetadata = {
    compactedAt: Date.now(),
    compactType,
    compactPath,
    headMessageId,
    anchorMessageId,
    tailMessageId,
    originalMessageIds,
    summaryMessageId: summaryId,
  };

  const boundaryMsg = {
    id: boundaryId,
    role: 'system' as const,
    text: '[Context compact boundary]',
    compactBoundary: true,
    compactMetadata: metadata,
    createdAt: metadata.compactedAt,
  } as unknown as T;

  const summaryMsg = {
    id: summaryId,
    role: 'user' as const,
    text: summaryText,
    compactSummary: true,
    createdAt: metadata.compactedAt,
  } as unknown as T;

  // Preserve any leading system messages (runtime prompt) before compact artifacts
  const leadingSystem: T[] = [];
  for (let i = 0; i < split.prefixStart; i++) {
    const msg = messages[i];
    if (msg.role === 'system' && !msg.compactBoundary) {
      leadingSystem.push(msg);
    }
  }

  const priorCompactArtifacts: T[] = [];
  for (let i = 0; i < split.prefixStart; i++) {
    const msg = messages[i];
    if (msg.compactBoundary || msg.compactSummary) {
      priorCompactArtifacts.push(msg);
    }
  }

  const result = [
    ...leadingSystem,
    ...priorCompactArtifacts,
    boundaryMsg,
    summaryMsg,
    ...keepMessages,
  ];

  return { messages: result, metadata };
}

export function evaluateCompactResult<T extends CompactableMessage>(
  messages: T[],
  originalTokens: number,
  compacted: boolean,
  compactPath: CompactPath | null,
  metadata: CompactMetadata | null
): CompactResult<T> {
  const compressedTokens = messages.reduce(
    (sum, m) => sum + estimateMessageTokens(toBudgetMessage(m)),
    0
  );
  return {
    messages,
    compacted,
    compactPath,
    compactMetadata: metadata,
    originalTokens,
    compressedTokens,
  };
}

export function messagesToConversationText(messages: CompactableMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const text =
      typeof msg.text === 'string' ? msg.text : typeof msg.content === 'string' ? msg.content : '';
    if (!text.trim()) continue;
    lines.push(`[${msg.role}] ${text}`);
  }
  return lines.join('\n\n');
}
