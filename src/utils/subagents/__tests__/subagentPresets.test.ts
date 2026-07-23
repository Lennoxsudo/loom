import { describe, expect, it } from 'vitest';
import { BUILTIN_SUBAGENTS } from '../builtins';
import { resolveSubagentToolNames } from '../toolMapping';

describe('Explore subagent graph preset', () => {
  it('includes graph_query and graph_trace but not graph_index', () => {
    const explore = BUILTIN_SUBAGENTS.find((agent) => agent.name === 'Explore');
    expect(explore).toBeDefined();

    const parentTools = ['read', 'write', 'graph_index', 'graph_query', 'graph_trace', 'search'];
    const allowed = resolveSubagentToolNames(explore!, parentTools);

    expect(allowed).toContain('graph_query');
    expect(allowed).toContain('graph_trace');
    expect(allowed).not.toContain('graph_index');
  });

  it('Explore prompt forbids project_id and graph_index', () => {
    const explore = BUILTIN_SUBAGENTS.find((agent) => agent.name === 'Explore');
    expect(explore?.prompt).toContain('never use project_id');
    expect(explore?.prompt).toContain('do not run graph_index');
    expect(explore?.disallowedTools).toContain('graph_index');
  });
});
