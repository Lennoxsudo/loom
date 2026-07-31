/**
 * Agent Memory — user-scoped durable notes (USER.md / MEMORY.md).
 * Independent of Project Memory (~/.loom/memory/{projectKey}).
 */

import { invoke } from '@tauri-apps/api/core';

export const AGENT_MEMORY_DIR_NAME = 'agent-memory';
export const AGENT_MEMORY_FILE = 'MEMORY.md';
export const AGENT_USER_FILE = 'USER.md';
export const ENTRY_SEPARATOR = '\n§\n';

export const MEMORY_CHAR_LIMIT = 2200;
export const USER_CHAR_LIMIT = 1375;

export type AgentMemoryTarget = 'memory' | 'user';
export type AgentMemoryAction = 'add' | 'replace' | 'remove';

export interface AgentMemoryFlags {
  enableAgentMemory: boolean;
  enableAgentMemoryUserProfile: boolean;
  enableAgentMemoryNotes: boolean;
}

export interface AgentMemoryMutationResult {
  ok: boolean;
  entries: string[];
  usage: string;
  message?: string;
  error?: string;
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const trimmedBase = base.replace(/[\\/]+$/, '');
  return [trimmedBase, ...parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ''))].join(sep);
}

let _dotConfigPath: string | null = null;

async function getDotConfigPath(): Promise<string> {
  if (_dotConfigPath) return _dotConfigPath;
  try {
    const path = await invoke<string>('get_dot_config_path');
    _dotConfigPath = typeof path === 'string' && path.length > 0 ? path : '';
  } catch {
    _dotConfigPath = '';
  }
  return _dotConfigPath ?? '';
}

export async function getAgentMemoryDir(): Promise<string> {
  const dotConfig = await getDotConfigPath();
  if (!dotConfig) return '';
  return joinPath(dotConfig, AGENT_MEMORY_DIR_NAME);
}

export function charLimitForTarget(target: AgentMemoryTarget): number {
  return target === 'user' ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

export function fileNameForTarget(target: AgentMemoryTarget): string {
  return target === 'user' ? AGENT_USER_FILE : AGENT_MEMORY_FILE;
}

export function parseEntries(raw: string): string[] {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  return text
    .split(ENTRY_SEPARATOR)
    .map((e) => e.trim())
    .filter(Boolean);
}

export function serializeEntries(entries: string[]): string {
  const cleaned = entries.map((e) => e.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  return `${cleaned.join(ENTRY_SEPARATOR)}\n`;
}

export function entriesCharCount(entries: string[]): number {
  return serializeEntries(entries).length;
}

export function formatUsage(entries: string[], limit: number): string {
  const used = entriesCharCount(entries);
  return `${used}/${limit}`;
}

/** Returns error message if content should be rejected; otherwise null. */
export function scanMemoryContent(content: string): string | null {
  const text = content.trim();
  if (!text) return 'content is empty';

  // Invisible / bidi control characters that can hide prompt injection
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/.test(text)) {
    return 'content contains invisible Unicode characters';
  }

  const lower = text.toLowerCase();
  const injectionHints = [
    'ignore previous instructions',
    'ignore all previous',
    'disregard previous',
    'system prompt',
    'you are now',
    '<|im_start|>',
    '```system',
  ];
  for (const hint of injectionHints) {
    if (lower.includes(hint)) {
      return 'content matches a blocked injection pattern';
    }
  }

  if (/(?:sk-|api[_-]?key|secret[_-]?key|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/i.test(text)) {
    return 'content looks like a credential or secret';
  }

  return null;
}

export function findEntryBySubstring(
  entries: string[],
  oldText: string
): { ok: true; index: number } | { ok: false; error: string } {
  const needle = oldText.trim();
  if (!needle) return { ok: false, error: 'old_text is required' };

  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.includes(needle));

  if (matches.length === 0) {
    return { ok: false, error: `No entry matched old_text=${JSON.stringify(needle)}` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `old_text matched ${matches.length} entries; use a more specific substring`,
    };
  }
  return { ok: true, index: matches[0]!.index };
}

/** Strip case / punctuation / whitespace so near-paraphrases can be compared. */
export function normalizeMemoryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function charCounts(normalized: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of normalized) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

/** Dice coefficient over character multisets (0–1). Better for short CJK paraphrases than bigrams. */
export function memoryTextSimilarity(a: string, b: string): number {
  const na = normalizeMemoryText(a);
  const nb = normalizeMemoryText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  // Containment of a substantial normalized string → treat as near-duplicate.
  if (shorter.length >= 6 && longer.includes(shorter)) {
    return 1;
  }

  const ca = charCounts(na);
  const cb = charCounts(nb);
  let intersection = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const n of ca.values()) sizeA += n;
  for (const n of cb.values()) sizeB += n;
  if (sizeA === 0 || sizeB === 0) return 0;

  const keys = new Set([...ca.keys(), ...cb.keys()]);
  for (const key of keys) {
    intersection += Math.min(ca.get(key) ?? 0, cb.get(key) ?? 0);
  }
  return (2 * intersection) / (sizeA + sizeB);
}

/** Reject add when similarity is at or above this threshold (exact match handled separately). */
export const NEAR_DUPLICATE_THRESHOLD = 0.72;

export function findNearDuplicateEntry(
  entries: string[],
  content: string
): { index: number; entry: string; score: number } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let best: { index: number; entry: string; score: number } | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry === trimmed) continue; // exact handled elsewhere
    const score = memoryTextSimilarity(entry, trimmed);
    if (score < NEAR_DUPLICATE_THRESHOLD) continue;
    if (!best || score > best.score) {
      best = { index: i, entry, score };
    }
  }
  return best;
}

export function applyAgentMemoryMutation(
  entries: string[],
  action: AgentMemoryAction,
  options: { content?: string; oldText?: string; limit: number }
): AgentMemoryMutationResult {
  const limit = options.limit;
  const usageOf = (next: string[]) => formatUsage(next, limit);

  if (action === 'add') {
    const content = options.content?.trim() ?? '';
    const scanError = scanMemoryContent(content);
    if (scanError) {
      return { ok: false, entries, usage: usageOf(entries), error: scanError };
    }
    if (entries.some((e) => e === content)) {
      return {
        ok: true,
        entries,
        usage: usageOf(entries),
        message: 'No duplicate added; entry already exists.',
      };
    }
    const near = findNearDuplicateEntry(entries, content);
    if (near) {
      return {
        ok: false,
        entries,
        usage: usageOf(entries),
        error: `Near-duplicate of existing entry ${JSON.stringify(near.entry)}. Use replace with old_text set to that entry (or a unique substring), or remove it first — do not add again.`,
      };
    }
    const next = [...entries, content];
    const used = entriesCharCount(next);
    if (used > limit) {
      return {
        ok: false,
        entries,
        usage: usageOf(entries),
        error: `Memory at ${usageOf(entries)}. Adding this entry (${content.length} chars) would exceed the limit. Consolidate now: use replace to merge overlapping entries or remove stale ones, then retry add — all in this turn.`,
      };
    }
    return {
      ok: true,
      entries: next,
      usage: usageOf(next),
      message: `Added entry (${content.length} chars). Usage ${usageOf(next)}.`,
    };
  }

  if (action === 'replace') {
    const content = options.content?.trim() ?? '';
    const scanError = scanMemoryContent(content);
    if (scanError) {
      return { ok: false, entries, usage: usageOf(entries), error: scanError };
    }
    const found = findEntryBySubstring(entries, options.oldText ?? '');
    if (!found.ok) {
      return { ok: false, entries, usage: usageOf(entries), error: found.error };
    }
    const next = entries.slice();
    next[found.index] = content;
    const used = entriesCharCount(next);
    if (used > limit) {
      return {
        ok: false,
        entries,
        usage: usageOf(entries),
        error: `Replace would exceed limit (${used}/${limit}). Shorten content or remove other entries first.`,
      };
    }
    return {
      ok: true,
      entries: next,
      usage: usageOf(next),
      message: `Replaced entry. Usage ${usageOf(next)}.`,
    };
  }

  if (action === 'remove') {
    const found = findEntryBySubstring(entries, options.oldText ?? '');
    if (!found.ok) {
      return { ok: false, entries, usage: usageOf(entries), error: found.error };
    }
    const next = entries.filter((_, i) => i !== found.index);
    return {
      ok: true,
      entries: next,
      usage: usageOf(next),
      message: `Removed entry. Usage ${usageOf(next)}.`,
    };
  }

  return { ok: false, entries, usage: usageOf(entries), error: 'unknown action' };
}

function formatStoreBlock(title: string, entries: string[], limit: number): string {
  const used = entriesCharCount(entries);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const header = `${title} [${pct}% — ${used}/${limit} chars]`;
  const body = entries.length > 0 ? entries.join(ENTRY_SEPARATOR) : '(empty)';
  return `${header}\n${body}`;
}

/** Render frozen system-prompt block; empty string when nothing to inject. */
export function formatAgentMemoryContext(
  flags: AgentMemoryFlags,
  stores: { user: string[]; memory: string[] }
): string {
  if (!flags.enableAgentMemory) return '';

  const parts: string[] = [];
  if (flags.enableAgentMemoryUserProfile) {
    parts.push(formatStoreBlock('USER PROFILE', stores.user, USER_CHAR_LIMIT));
  }
  if (flags.enableAgentMemoryNotes) {
    parts.push(formatStoreBlock('AGENT MEMORY', stores.memory, MEMORY_CHAR_LIMIT));
  }
  if (parts.length === 0) return '';

  return [
    '## Agent Memory (frozen for this session)',
    'Durable facts about the user and environment. Mid-session writes update disk immediately but this block stays frozen until the next conversation.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}

export function formatLiveEntriesSummary(target: AgentMemoryTarget, entries: string[]): string {
  const limit = charLimitForTarget(target);
  const label = target === 'user' ? 'user' : 'memory';
  if (entries.length === 0) {
    return `Live ${label} entries (0) — usage ${formatUsage(entries, limit)}: (empty)`;
  }
  const listed = entries.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return `Live ${label} entries (${entries.length}) — usage ${formatUsage(entries, limit)}:\n${listed}`;
}

async function readTargetFile(target: AgentMemoryTarget): Promise<string> {
  const dir = await getAgentMemoryDir();
  if (!dir) return '';
  const filePath = joinPath(dir, fileNameForTarget(target));
  try {
    return (await invoke<string>('read_file_content', { filePath })) ?? '';
  } catch {
    return '';
  }
}

async function writeTargetFile(target: AgentMemoryTarget, content: string): Promise<void> {
  const dir = await getAgentMemoryDir();
  if (!dir) throw new Error('Unable to resolve agent-memory directory');

  try {
    await invoke('create_folder', { folderPath: dir });
  } catch {
    // may already exist
  }

  await invoke('write_file_content', {
    filePath: joinPath(dir, fileNameForTarget(target)),
    content,
  });
}

export async function loadAgentMemoryEntries(target: AgentMemoryTarget): Promise<string[]> {
  const raw = await readTargetFile(target);
  return parseEntries(raw);
}

export async function loadAgentMemoryContext(flags: AgentMemoryFlags): Promise<string> {
  if (!flags.enableAgentMemory) return '';
  const needUser = flags.enableAgentMemoryUserProfile;
  const needNotes = flags.enableAgentMemoryNotes;
  if (!needUser && !needNotes) return '';

  const [user, memory] = await Promise.all([
    needUser ? loadAgentMemoryEntries('user') : Promise.resolve([] as string[]),
    needNotes ? loadAgentMemoryEntries('memory') : Promise.resolve([] as string[]),
  ]);

  return formatAgentMemoryContext(flags, { user, memory });
}

/**
 * Resolve frozen snapshot for a conversation.
 * Once captured, returns the same text for the rest of the session.
 */
export async function resolveAgentMemoryFrozenSnapshot(options: {
  flags: AgentMemoryFlags;
  alreadyCaptured: boolean;
  frozenText?: string;
}): Promise<{ text: string; justCaptured: boolean }> {
  if (options.alreadyCaptured) {
    return { text: options.frozenText ?? '', justCaptured: false };
  }
  const text = await loadAgentMemoryContext(options.flags);
  return { text, justCaptured: true };
}

export async function mutateAgentMemoryStore(
  target: AgentMemoryTarget,
  action: AgentMemoryAction,
  options: { content?: string; oldText?: string; flags: AgentMemoryFlags }
): Promise<AgentMemoryMutationResult & { liveSummary: string }> {
  const { flags } = options;
  if (!flags.enableAgentMemory) {
    return {
      ok: false,
      entries: [],
      usage: '0/0',
      error: 'Agent Memory is disabled in settings',
      liveSummary: '',
    };
  }
  if (target === 'user' && !flags.enableAgentMemoryUserProfile) {
    return {
      ok: false,
      entries: [],
      usage: '0/0',
      error: 'User profile memory is disabled in settings',
      liveSummary: '',
    };
  }
  if (target === 'memory' && !flags.enableAgentMemoryNotes) {
    return {
      ok: false,
      entries: [],
      usage: '0/0',
      error: 'Agent notes memory is disabled in settings',
      liveSummary: '',
    };
  }

  const entries = await loadAgentMemoryEntries(target);
  const result = applyAgentMemoryMutation(entries, action, {
    content: options.content,
    oldText: options.oldText,
    limit: charLimitForTarget(target),
  });

  if (result.ok) {
    const unchanged =
      result.entries.length === entries.length &&
      result.entries.every((e, i) => e === entries[i]);
    if (!unchanged) {
      await writeTargetFile(target, serializeEntries(result.entries));
    }
  }

  return {
    ...result,
    liveSummary: formatLiveEntriesSummary(target, result.ok ? result.entries : entries),
  };
}

/** Settings UI: delete one entry by index (avoids ambiguous substring matches). */
export async function removeAgentMemoryEntryByIndex(
  target: AgentMemoryTarget,
  index: number,
  flags: AgentMemoryFlags
): Promise<AgentMemoryMutationResult & { liveSummary: string }> {
  if (!flags.enableAgentMemory) {
    return {
      ok: false,
      entries: [],
      usage: '0/0',
      error: 'Agent Memory is disabled in settings',
      liveSummary: '',
    };
  }
  if (target === 'user' && !flags.enableAgentMemoryUserProfile) {
    return {
      ok: false,
      entries: [],
      usage: '0/0',
      error: 'User profile memory is disabled in settings',
      liveSummary: '',
    };
  }
  if (target === 'memory' && !flags.enableAgentMemoryNotes) {
    return {
      ok: false,
      entries: [],
      usage: '0/0',
      error: 'Agent notes memory is disabled in settings',
      liveSummary: '',
    };
  }

  const entries = await loadAgentMemoryEntries(target);
  const limit = charLimitForTarget(target);
  if (index < 0 || index >= entries.length) {
    return {
      ok: false,
      entries,
      usage: formatUsage(entries, limit),
      error: 'entry index out of range',
      liveSummary: formatLiveEntriesSummary(target, entries),
    };
  }

  const next = entries.filter((_, i) => i !== index);
  await writeTargetFile(target, serializeEntries(next));
  return {
    ok: true,
    entries: next,
    usage: formatUsage(next, limit),
    message: `Removed entry. Usage ${formatUsage(next, limit)}.`,
    liveSummary: formatLiveEntriesSummary(target, next),
  };
}
