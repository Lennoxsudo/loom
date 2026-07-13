import type { ToolDefinition } from '../../types/ai';
import { AI_TOOLS } from '../../features/agent-engine/definitions';

/** Claude Code tool name → Loom canonical tool name */
export const CLAUDE_TO_AI_TOOL: Record<string, string> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Bash: 'term',
  bash: 'term',
  Grep: 'search',
  Glob: 'search',
  Agent: 'Agent',
  Task: 'Agent',
  WebFetch: 'fetch',
  WebSearch: 'web_search',
  Browser: 'browser',
  TodoWrite: 'todo',
  Skill: 'skill',
};

export const SPAWN_TOOL_NAMES = new Set(['Agent', 'Task', 'run_subagent', 'run_subagents']);

export function mapClaudeToolName(name: string): string {
  return CLAUDE_TO_AI_TOOL[name] ?? name;
}

export function mapClaudeToolNames(names: string[]): string[] {
  const mapped = names.map(mapClaudeToolName);
  return [...new Set(mapped)];
}

export function resolveSubagentToolNames(
  def: { tools?: string[]; disallowedTools?: string[] },
  parentToolNames: string[]
): string[] {
  const cleaned = parentToolNames.filter((n) => typeof n === 'string' && n.length > 0);
  let pool = cleaned.length > 0 ? [...cleaned] : AI_TOOLS.map((t) => t.name);

  if (def.disallowedTools?.length) {
    const denied = new Set(mapClaudeToolNames(def.disallowedTools));
    pool = pool.filter((n) => !denied.has(n));
  }

  if (def.tools?.length) {
    const allowed = new Set(mapClaudeToolNames(def.tools));
    pool = pool.filter((n) => allowed.has(n));
  }

  return pool;
}

export function resolveSubagentToolDefinitions(
  allowedNames: string[],
  parentMcpTools: ToolDefinition[] = []
): ToolDefinition[] {
  const nameSet = new Set(allowedNames);
  const fromAi = AI_TOOLS.filter((t) => nameSet.has(t.name));
  const mcp = parentMcpTools.filter((t) => nameSet.has(t.name));
  const seen = new Set<string>();
  const merged: ToolDefinition[] = [];
  for (const t of [...fromAi, ...mcp]) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      merged.push(t);
    }
  }
  return merged;
}

export function isSpawnToolAllowed(
  allowedNames: string[],
  depth: number,
  background: boolean
): boolean {
  const hasSpawn = allowedNames.some((n) => SPAWN_TOOL_NAMES.has(n));
  if (!hasSpawn) return false;
  if (background && depth >= 5) return false;
  return true;
}

export function filterSpawnTools(allowedNames: string[], canNest: boolean): string[] {
  if (canNest) return allowedNames;
  return allowedNames.filter((n) => !SPAWN_TOOL_NAMES.has(n));
}
