import { describe, it, expect } from 'vitest';
import {
  mapClaudeToolName,
  resolveSubagentToolNames,
  filterSpawnTools,
  SPAWN_TOOL_NAMES,
} from '../toolMapping';
import { BUILTIN_SUBAGENTS } from '../builtins';

describe('toolMapping', () => {
  it('maps Claude tool names to Loom names', () => {
    expect(mapClaudeToolName('Read')).toBe('read');
    expect(mapClaudeToolName('Bash')).toBe('term');
    expect(mapClaudeToolName('Agent')).toBe('Agent');
  });

  it('intersects definition tools with parent tool pool', () => {
    const explore = BUILTIN_SUBAGENTS.find((a) => a.name === 'Explore')!;
    const names = resolveSubagentToolNames(explore, ['read', 'write', 'term', 'mcp_foo__bar']);
    expect(names).toContain('read');
    expect(names).not.toContain('write');
    expect(names).not.toContain('term');
  });

  it('falls back to AI_TOOLS when parentToolNames are empty or invalid', () => {
    const explore = BUILTIN_SUBAGENTS.find((a) => a.name === 'Explore')!;
    const fromEmpty = resolveSubagentToolNames(explore, []);
    expect(fromEmpty.length).toBeGreaterThan(0);
    expect(fromEmpty).toContain('read');

    const fromUndefined = resolveSubagentToolNames(explore, [
      undefined as unknown as string,
      '',
    ]);
    expect(fromUndefined.length).toBeGreaterThan(0);
    expect(fromUndefined).toContain('read');
  });

  it('filters spawn tools when nesting is disabled', () => {
    const withSpawn = ['read', 'Agent', 'run_subagent'];
    const filtered = filterSpawnTools(withSpawn, false);
    expect(filtered).toEqual(['read']);
    expect(SPAWN_TOOL_NAMES.has('Agent')).toBe(true);
  });
});
