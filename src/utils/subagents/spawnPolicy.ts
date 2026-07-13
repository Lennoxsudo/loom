import type { ToolContext } from '../../features/agent-engine/types';

/** Matches the main agent tool loop default in useAgentToolCalls. */
export const DEFAULT_SUBAGENT_MAX_ROUNDS = 10;

const DEFAULT_SUBAGENT_CONTEXT_TOKENS = 200_000;

export function resolveSubagentMaxRounds(
  options: { maxToolRounds?: number },
  def: { maxTurns?: number }
): number {
  return options.maxToolRounds ?? def.maxTurns ?? DEFAULT_SUBAGENT_MAX_ROUNDS;
}

/**
 * Returns a truncation budget when AI explicitly sets context_budget.
 * Returns null when no truncation should be applied.
 */
export function resolveSubagentContextTruncationBudget(options: {
  contextBudget?: number;
}): number | null {
  if (options.contextBudget === undefined || options.contextBudget <= 0) {
    return null;
  }
  return Math.min(200_000, Math.max(4_000, options.contextBudget));
}

export function resolveSubagentContextTokensForLoop(options: {
  contextBudget?: number;
  parentContext?: ToolContext;
}): number {
  const explicit = resolveSubagentContextTruncationBudget(options);
  if (explicit !== null) {
    return explicit;
  }
  return options.parentContext?.maxContextTokens ?? DEFAULT_SUBAGENT_CONTEXT_TOKENS;
}
