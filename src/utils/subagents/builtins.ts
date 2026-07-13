import type { SubagentDefinition } from './types';

const READ_ONLY_TOOLS = [
  'read',
  'search',
  'finfo',
  'sym',
  'fetch',
  'web_search',
  'graph_query',
  'graph_trace',
];

export const BUILTIN_SUBAGENTS: SubagentDefinition[] = [
  {
    name: 'Explore',
    description:
      'Fast read-only agent for searching and analyzing codebases. Use for file discovery, code search, and exploration without making changes.',
    prompt:
      'You are the Explore subagent. Search and analyze the codebase efficiently using read-only tools. ' +
      'For structural questions use graph_query / graph_trace when the project is indexed; do not run graph_index. ' +
      'Pass repo_path (or omit for workspace); never use project_id. ' +
      'Be thorough but concise. Return a structured summary of findings, file paths, and key insights.',
    tools: READ_ONLY_TOOLS,
    disallowedTools: ['graph_index'],
    model: 'haiku',
    source: 'builtin',
    skipClaudeMd: true,
    skipRules: true,
    skipSkillsIndex: true,
    canNest: false,
  },
  {
    name: 'Plan',
    description:
      'Research agent for gathering context before planning. Use in plan mode to explore the codebase read-only.',
    prompt:
      'You are the Plan subagent. Research the codebase read-only to support planning. ' +
      'For graph tools use graph_query / graph_trace only; pass repo_path, never project_id. ' +
      'Summarize architecture, relevant files, constraints, and recommended approach.',
    tools: READ_ONLY_TOOLS,
    model: 'inherit',
    permissionMode: 'plan',
    source: 'builtin',
    skipClaudeMd: true,
    skipRules: true,
    canNest: false,
  },
  {
    name: 'general-purpose',
    description:
      'Capable agent for complex multi-step tasks requiring both exploration and action.',
    prompt:
      'You are a general-purpose subagent. Execute the delegated task efficiently using available tools. ' +
      'Return a structured summary with conclusions, actions taken, artifacts, and blockers.',
    source: 'builtin',
    model: 'inherit',
    canNest: true,
  },
  // Legacy preset aliases
  {
    name: 'research',
    description: 'Alias for read-only codebase research (maps to Explore-style behavior).',
    prompt:
      'You are a read-only research subagent. Analyze and summarize findings without modifying files.',
    tools: READ_ONLY_TOOLS,
    model: 'inherit',
    source: 'builtin',
    skipClaudeMd: true,
    skipRules: true,
    canNest: false,
  },
  {
    name: 'parallel-exec',
    description: 'Alias for parallel execution subtasks with write access.',
    prompt:
      'You are an execution subagent. Complete the delegated task and summarize changes made.',
    tools: ['read', 'write', 'edit', 'search', 'finfo', 'sym', 'term'],
    model: 'inherit',
    source: 'builtin',
    canNest: false,
  },
];

export const BUILTIN_AGENT_NAMES = new Set(BUILTIN_SUBAGENTS.map((a) => a.name));
