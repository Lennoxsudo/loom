/**
 * Shared context injection state management.
 *
 * Provides a concurrency-safe state machine (idle → pending → committed)
 * for tracking whether project-path context has been injected into a
 * conversation, with path-hash fingerprinting to detect changes.
 */
import type { AgentConversation, ProjectPathInjectionState } from '../types/chat';

// ── Hashing ──────────────────────────────────────────────────────────
/**
 * Generate a simple hash from a string for fingerprinting.
 * Uses djb2 algorithm — fast, deterministic, and sufficient for cache keys.
 */
export function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

// ── State Machine ────────────────────────────────────────────────────

/**
 * In-memory pending-lock registry, keyed by conversationId.
 * Prevents concurrent double-injection on the same conversation
 * (e.g. double-click on Send).
 */
const pendingLocks = new Map<string, { requestId: string }>();

// ── Core Logic ───────────────────────────────────────────────────────

/**
 * Determine whether the project path context should be injected.
 *
 * Returns `true` when any of the following hold:
 *  1. The conversation has never been injected yet.
 *  2. The project path has changed (hash mismatch).
 *  3. There is no pending lock (prevents concurrent injection).
 */
export function shouldInjectProjectPath(
  conversation: AgentConversation | undefined,
  currentProjectPath: string
): boolean {
  if (!currentProjectPath.trim()) return false;
  if (!conversation) return true; // brand-new conversation

  const convId = conversation.id;
  // If another request is already pending on this conversation, skip
  if (pendingLocks.has(convId)) return false;

  const state = conversation.contextInjected?.projectPath;
  if (!state || !state.injected) return true;

  // Path changed → re-inject
  return state.pathHash !== hashString(currentProjectPath);
}

/**
 * Mark the injection as pending for a given conversation + request.
 * Returns `false` if the lock is already held (concurrent request).
 */
export function markInjectionPending(conversationId: string, requestId: string): boolean {
  if (pendingLocks.has(conversationId)) return false;
  pendingLocks.set(conversationId, { requestId });
  return true;
}

/**
 * Build the committed injection state and release the pending lock.
 * Only commits if the requestId matches the one that acquired the lock.
 *
 * Returns the `ProjectPathInjectionState` to persist into the conversation,
 * or `undefined` if the requestId does not match.
 */
export function commitInjection(
  conversationId: string,
  requestId: string,
  projectPath: string
): ProjectPathInjectionState | undefined {
  const lock = pendingLocks.get(conversationId);
  if (!lock || lock.requestId !== requestId) return undefined;
  pendingLocks.delete(conversationId);
  return {
    injected: true,
    pathHash: hashString(projectPath),
    injectedAt: Date.now(),
  };
}

/**
 * Release a pending lock without committing (e.g. on failure / rollback).
 */
export function rollbackInjection(conversationId: string, requestId: string): void {
  const lock = pendingLocks.get(conversationId);
  if (lock && lock.requestId === requestId) {
    pendingLocks.delete(conversationId);
  }
}

/**
 * Reset the injection state for testing purposes.
 * @internal
 */
export function _resetPendingLocks(): void {
  pendingLocks.clear();
}
