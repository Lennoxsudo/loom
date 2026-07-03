export type SubagentSource = 'builtin' | 'project' | 'user';

export type SubagentPermissionMode =
  | 'default'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions'
  | 'acceptEdits'
  | 'auto';

export type SubagentSpawnMode = 'isolated' | 'fork';

export type SubagentIsolation = 'worktree';

export interface SubagentDefinition {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: SubagentPermissionMode;
  background?: boolean;
  color?: string;
  skills?: string[];
  mcpServers?: Array<string | Record<string, unknown>>;
  isolation?: SubagentIsolation;
  source: SubagentSource;
  filePath?: string;
  skipClaudeMd?: boolean;
  skipRules?: boolean;
  skipSkillsIndex?: boolean;
  canNest?: boolean;
}

export interface SpawnSubagentOptions {
  taskId: string;
  prompt: string;
  subagentType?: string;
  context?: string;
  model?: string;
  allowedTools?: string[];
  maxToolRounds?: number;
  contextBudget?: number;
  async?: boolean;
  spawnMode?: SubagentSpawnMode;
  parentProvider: string;
  parentModel: string;
  parentContext?: import('../aiTools/types').ToolContext;
  parentToolNames?: string[];
}
