/**
 * Session memory compaction — LLM summary with rule-based fallback.
 * @module compact/sessionMemoryCompact
 */

import { invoke } from '@tauri-apps/api/core';
import { buildRuleBasedSummary } from '../contextCompressor';
import { buildCompactPrompt, parseCompactResponse, type CompactPromptMode } from './prompt';
import { messagesToConversationText } from './compact';
import type { CompactableMessage } from './types';
import type { SplitByRetention } from './grouping';

export interface GenerateSummaryResult {
  summaryText: string;
  usedLlm: boolean;
}

export async function generateCompactSummary(opts: {
  prefixMessages: CompactableMessage[];
  split: SplitByRetention;
  provider: string;
  model: string;
  profileId?: string;
  promptMode?: CompactPromptMode;
}): Promise<GenerateSummaryResult> {
  const { prefixMessages, split, provider, model, profileId, promptMode = 'base' } = opts;
  const conversationText = messagesToConversationText(prefixMessages);
  const prompt = buildCompactPrompt(promptMode, conversationText);

  try {
    const raw = await invoke<string>('generate_compact_summary', {
      provider,
      model,
      profileId: profileId ?? null,
      promptText: prompt,
      messagesJson: JSON.stringify(prefixMessages.map(formatForRust)),
    });

    const parsed = parseCompactResponse(raw);
    if (parsed && parsed.length > 30) {
      return { summaryText: parsed, usedLlm: true };
    }
  } catch (error) {
    console.warn('[compact] LLM summary failed, falling back to rules:', error);
  }

  const ruleSummary = buildRuleBasedSummary(
    prefixMessages.map((m) => ({
      role: m.role,
      content: m.text ?? m.content ?? '',
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    })),
    split.prefixStart,
    split.prefixEnd
  );

  return { summaryText: ruleSummary.summary, usedLlm: false };
}

function formatForRust(msg: CompactableMessage): Record<string, unknown> {
  return {
    role: msg.role,
    content: msg.text ?? msg.content ?? '',
    tool_calls: msg.tool_calls ?? null,
    tool_call_id: msg.tool_call_id ?? null,
    tool_name: msg.tool_name ?? null,
  };
}
