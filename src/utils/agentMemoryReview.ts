/**
 * Post-turn Agent Memory review (phase 3).
 * Rule-based extraction only — no extra LLM calls.
 */

import type { ChatMessage } from '../types/chat';
import {
  applyAgentMemoryMutation,
  charLimitForTarget,
  loadAgentMemoryEntries,
  mutateAgentMemoryStore,
  type AgentMemoryFlags,
  type AgentMemoryTarget,
} from './agentMemory';
import { stageAgentMemoryPending } from './agentMemoryPending';
import { useSettingsStore } from '../stores/useSettingsStore';

export interface MemoryReviewCandidate {
  target: AgentMemoryTarget;
  content: string;
  reason: string;
}

export interface RunAgentMemoryReviewOptions {
  conversationId: string;
  messages: ChatMessage[];
}

export interface RunAgentMemoryReviewResult {
  skipped: boolean;
  reason?: string;
  staged: number;
  written: number;
  candidates: MemoryReviewCandidate[];
  /** Pending items created when write-approval is on (for content-area cards). */
  stagedItems: Array<{
    id: string;
    target: 'user' | 'memory';
    content: string;
    reason: string;
  }>;
}

const MAX_CANDIDATE_CHARS = 200;

/** Explicit remember / preference / correction cues in the latest user turn. */
export function extractMemoryCandidatesFromMessages(
  messages: ChatMessage[]
): MemoryReviewCandidate[] {
  const turnUserTexts = collectLatestTurnUserTexts(messages);
  const out: MemoryReviewCandidate[] = [];
  const seen = new Set<string>();

  for (const text of turnUserTexts) {
    for (const candidate of extractFromUserText(text)) {
      const key = `${candidate.target}:${candidate.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
  }

  return out.slice(0, 3);
}

function collectLatestTurnUserTexts(messages: ChatMessage[]): string[] {
  // Walk backward to the last user message that starts the latest turn,
  // including any consecutive user messages after the previous assistant.
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant' && !messages[i]?.isStreaming) {
      // Prefer the final completed assistant; still include users after previous ones.
      lastAssistantIdx = i;
      break;
    }
  }

  // Find the user message(s) that triggered this turn: nearest user before last assistant,
  // or trailing users if no assistant yet.
  const texts: string[] = [];
  if (lastAssistantIdx < 0) {
    for (const m of messages) {
      if (m.role === 'user' && m.text?.trim()) texts.push(m.text.trim());
    }
    return texts.slice(-2);
  }

  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' && m.text?.trim()) {
      texts.unshift(m.text.trim());
      // stop at previous assistant boundary
      continue;
    }
    if (m.role === 'assistant' || m.role === 'tool') break;
  }
  return texts.slice(-2);
}

export function extractFromUserText(text: string): MemoryReviewCandidate[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2000) return [];

  const candidates: MemoryReviewCandidate[] = [];

  const rememberPatterns: RegExp[] = [
    /(?:请)?记住[:：]\s*(.+)$/im,
    /remember(?:\s+that)?[:：]?\s+(.+)$/im,
    /别再(?:要)?\s*(.+)$/im,
    /don'?t\s+(.+?\bagain\b.*)$/im,
  ];

  for (const re of rememberPatterns) {
    const m = trimmed.match(re);
    const captured = m?.[1]?.trim();
    if (captured) {
      candidates.push({
        target: inferTarget(captured),
        content: compactContent(captured),
        reason: 'explicit_remember',
      });
    }
  }

  const preferPatterns: RegExp[] = [
    /(?:我)?(?:更)?(?:喜欢|偏好)\s*(.+)$/im,
    /i\s+prefer\s+(.+)$/im,
    /prefer(?:s)?\s+(.+)$/im,
  ];

  for (const re of preferPatterns) {
    const m = trimmed.match(re);
    const captured = m?.[1]?.trim();
    if (captured) {
      candidates.push({
        target: 'user',
        content: compactContent(`prefers ${captured}`),
        reason: 'preference',
      });
    }
  }

  return candidates.filter((c) => c.content.length > 0 && c.content.length <= MAX_CANDIDATE_CHARS);
}

function inferTarget(content: string): AgentMemoryTarget {
  const lower = content.toLowerCase();
  if (
    /prefer|喜欢|偏好|简洁|详细|沟通|语气|回复|reply|concise|verbose|timezone|时区|name|名字/.test(
      lower
    )
  ) {
    return 'user';
  }
  return 'memory';
}

function compactContent(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_CHARS);
}

/** True if this turn already wrote agent memory via the tool. */
export function turnAlreadyWroteAgentMemory(messages: ChatMessage[]): boolean {
  const recent = messages.slice(-30);
  for (const m of recent) {
    if (m.role !== 'tool') continue;
    const name = (m.tool_name ?? '').toLowerCase();
    if (name !== 'agent_memory') continue;
    if (m.isError) continue;
    const text = (m.text ?? '').toLowerCase();
    if (
      text.includes('added entry') ||
      text.includes('replaced entry') ||
      text.includes('staged for approval') ||
      text.includes('usage')
    ) {
      return true;
    }
    if (text.trim()) return true;
  }
  return false;
}

function readFlags(): AgentMemoryFlags & {
  enableAgentMemoryReview: boolean;
  agentMemoryWriteApproval: boolean;
} {
  const s = useSettingsStore.getState();
  return {
    enableAgentMemory: s.enableAgentMemory,
    enableAgentMemoryUserProfile: s.enableAgentMemoryUserProfile,
    enableAgentMemoryNotes: s.enableAgentMemoryNotes,
    enableAgentMemoryReview: s.enableAgentMemoryReview,
    agentMemoryWriteApproval: s.agentMemoryWriteApproval,
  };
}

/**
 * Fire-and-forget safe entry: no-ops when review is disabled.
 * Does not call any LLM.
 */
export async function runAgentMemoryReview(
  options: RunAgentMemoryReviewOptions
): Promise<RunAgentMemoryReviewResult> {
  const flags = readFlags();
  if (!flags.enableAgentMemoryReview) {
    return {
      skipped: true,
      reason: 'review_disabled',
      staged: 0,
      written: 0,
      candidates: [],
      stagedItems: [],
    };
  }
  if (!flags.enableAgentMemory) {
    return {
      skipped: true,
      reason: 'memory_disabled',
      staged: 0,
      written: 0,
      candidates: [],
      stagedItems: [],
    };
  }

  if (turnAlreadyWroteAgentMemory(options.messages)) {
    return {
      skipped: true,
      reason: 'already_wrote',
      staged: 0,
      written: 0,
      candidates: [],
      stagedItems: [],
    };
  }

  const candidates = extractMemoryCandidatesFromMessages(options.messages).filter((c) => {
    if (c.target === 'user' && !flags.enableAgentMemoryUserProfile) return false;
    if (c.target === 'memory' && !flags.enableAgentMemoryNotes) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      skipped: true,
      reason: 'no_candidates',
      staged: 0,
      written: 0,
      candidates: [],
      stagedItems: [],
    };
  }

  let staged = 0;
  let written = 0;
  const stagedItems: RunAgentMemoryReviewResult['stagedItems'] = [];

  for (const candidate of candidates) {
    const entries = await loadAgentMemoryEntries(candidate.target);
    const probe = applyAgentMemoryMutation(entries, 'add', {
      content: candidate.content,
      limit: charLimitForTarget(candidate.target),
    });
    // Skip exact dupes (ok + unchanged) and near-dupes / scan failures (!ok).
    if (!probe.ok || probe.entries.length === entries.length) {
      continue;
    }

    if (flags.agentMemoryWriteApproval) {
      const item = await stageAgentMemoryPending({
        action: 'add',
        target: candidate.target,
        content: candidate.content,
        conversationId: options.conversationId,
        reason: candidate.reason,
      });
      staged += 1;
      stagedItems.push({
        id: item.id,
        target: candidate.target,
        content: candidate.content,
        reason: candidate.reason,
      });
      continue;
    }

    const result = await mutateAgentMemoryStore(candidate.target, 'add', {
      content: candidate.content,
      flags,
    });
    if (result.ok && result.entries.length > entries.length) written += 1;
  }

  return { skipped: false, staged, written, candidates, stagedItems };
}
