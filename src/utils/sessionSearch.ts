/**
 * On-demand search over persisted Agent conversations (projects/*.json).
 * Results are tool-output only — never injected into the system prompt.
 */

import { getProjectsIndex, getProjectState, projectStorageKey } from './agentPersistence';
import { normalizeProjectPath } from '../shared/lib/projectPath';

export const DEFAULT_SESSION_SEARCH_LIMIT = 20;
export const MAX_SESSION_SEARCH_LIMIT = 50;
export const SNIPPET_RADIUS = 120;

export interface SessionSearchHit {
  projectKey: string;
  projectPath: string;
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: string;
  createdAt?: number;
  snippet: string;
}

export interface SessionSearchOptions {
  query: string;
  projectPath?: string;
  conversationId?: string;
  limit?: number;
  /** Skip the first N hits (page within results / within a conversation). */
  offset?: number;
}

export interface SessionSearchResult {
  ok: boolean;
  hits: SessionSearchHit[];
  scannedConversations: number;
  offset: number;
  hasMore: boolean;
  error?: string;
}

/** Split query into lowercase terms (whitespace). Empty → no terms. */
export function parseSearchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** True if haystack contains every term (case-insensitive AND). */
export function textMatchesTerms(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const lower = haystack.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

export function buildSnippet(text: string, terms: string[], radius = SNIPPET_RADIUS): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  let anchor = 0;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) {
      anchor = idx;
      break;
    }
  }

  const start = Math.max(0, anchor - radius);
  const end = Math.min(normalized.length, anchor + (terms[0]?.length ?? 0) + radius);
  let snippet = normalized.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < normalized.length) snippet = `${snippet}…`;
  return snippet;
}

export function searchMessagesInConversations(
  conversations: Array<{
    id: string;
    title?: string;
    projectPath?: string;
    messages?: Array<{ id: string; role: string; text?: string; createdAt?: number }>;
  }>,
  options: {
    terms: string[];
    projectKey: string;
    projectPathFallback: string;
    conversationId?: string;
    limit: number;
    offset?: number;
  }
): SessionSearchHit[] {
  const hits: SessionSearchHit[] = [];
  const { terms, projectKey, projectPathFallback, conversationId, limit } = options;
  const offset = Math.max(0, options.offset ?? 0);
  if (terms.length === 0 || limit <= 0) return hits;

  let skipped = 0;
  for (const conversation of conversations) {
    if (conversationId && conversation.id !== conversationId) continue;
    const messages = conversation.messages ?? [];
    for (const message of messages) {
      if (message.role === 'system') continue;
      const text = typeof message.text === 'string' ? message.text : '';
      if (!text.trim() || !textMatchesTerms(text, terms)) continue;

      if (skipped < offset) {
        skipped += 1;
        continue;
      }

      hits.push({
        projectKey,
        projectPath: conversation.projectPath || projectPathFallback,
        conversationId: conversation.id,
        conversationTitle: conversation.title?.trim() || '(untitled)',
        messageId: message.id,
        role: message.role,
        createdAt: message.createdAt,
        snippet: buildSnippet(text, terms),
      });

      if (hits.length >= limit) return hits;
    }
  }

  return hits;
}

export function formatSessionSearchOutput(result: SessionSearchResult, query: string): string {
  if (!result.ok) {
    return result.error ?? 'session_search failed';
  }
  if (result.hits.length === 0) {
    const offsetNote = result.offset > 0 ? ` at offset ${result.offset}` : '';
    return `No matches for ${JSON.stringify(query)}${offsetNote} (scanned ${result.scannedConversations} conversation(s)).`;
  }

  const lines = [
    `Found ${result.hits.length} hit(s) for ${JSON.stringify(query)} (scanned ${result.scannedConversations} conversation(s), offset ${result.offset}):`,
    '',
  ];

  for (let i = 0; i < result.hits.length; i++) {
    const hit = result.hits[i]!;
    lines.push(
      `${result.offset + i + 1}. [${hit.role}] ${hit.conversationTitle}`,
      `   project: ${hit.projectPath}`,
      `   conversation_id: ${hit.conversationId}`,
      `   message_id: ${hit.messageId}`,
      `   snippet: ${hit.snippet}`,
      ''
    );
  }

  if (result.hasMore) {
    lines.push(
      `More results available — call again with offset=${result.offset + result.hits.length}.`
    );
  }

  return lines.join('\n').trimEnd();
}

export async function searchAgentSessions(
  options: SessionSearchOptions
): Promise<SessionSearchResult> {
  const terms = parseSearchTerms(options.query);
  if (terms.length === 0) {
    return {
      ok: false,
      hits: [],
      scannedConversations: 0,
      offset: 0,
      hasMore: false,
      error: 'query is required',
    };
  }

  const limit = Math.min(
    MAX_SESSION_SEARCH_LIMIT,
    Math.max(1, options.limit ?? DEFAULT_SESSION_SEARCH_LIMIT)
  );
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  // Fetch one extra hit past the page to detect hasMore.
  const fetchLimit = offset + limit + 1;

  let index;
  try {
    index = await getProjectsIndex();
  } catch (error) {
    return {
      ok: false,
      hits: [],
      scannedConversations: 0,
      offset,
      hasMore: false,
      error: error instanceof Error ? error.message : 'Failed to load projects index',
    };
  }

  const scopePath = options.projectPath?.trim()
    ? normalizeProjectPath(options.projectPath)
    : '';
  let scopeKey = '';
  if (scopePath) {
    try {
      scopeKey = await projectStorageKey(scopePath);
    } catch {
      scopeKey = '';
    }
  }

  const hits: SessionSearchHit[] = [];
  let scannedConversations = 0;

  for (const entry of index.projects ?? []) {
    if (scopeKey && entry.key !== scopeKey) continue;

    let state;
    try {
      state = await getProjectState(entry.key);
    } catch {
      continue;
    }
    if (!state?.conversations?.length) continue;

    scannedConversations += state.conversations.length;
    const remaining = fetchLimit - hits.length;
    if (remaining <= 0) break;

    const batch = searchMessagesInConversations(state.conversations, {
      terms,
      projectKey: entry.key,
      projectPathFallback: entry.path,
      conversationId: options.conversationId,
      limit: remaining,
    });
    hits.push(...batch);
  }

  const page = hits.slice(offset, offset + limit);
  const hasMore = hits.length > offset + limit;

  return { ok: true, hits: page, scannedConversations, offset, hasMore };
}
