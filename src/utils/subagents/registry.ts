import { invoke } from '@tauri-apps/api/core';
import { BUILTIN_SUBAGENTS } from './builtins';
import { frontmatterToDefinition, parseAgentMarkdown } from './frontmatter';
import type { SubagentDefinition } from './types';

const AGENTS_DIR = '.claude/agents';

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

async function listMdFilesRecursive(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const nodes = await invoke<Array<{ name: string; is_dir: boolean; path?: string }>>(
      'read_folder_children',
      { folderPath: dirPath }
    );
    for (const node of nodes) {
      const fullPath = node.path || joinPath(dirPath, node.name);
      if (node.is_dir) {
        const nested = await listMdFilesRecursive(fullPath);
        results.push(...nested);
      } else if (node.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore missing dirs
  }
  return results;
}

async function loadAgentsFromDir(
  dirPath: string,
  source: 'project' | 'user'
): Promise<SubagentDefinition[]> {
  const files = await listMdFilesRecursive(dirPath);
  const agents: SubagentDefinition[] = [];

  for (const filePath of files) {
    try {
      const raw = await invoke<string>('read_file_content', { filePath });
      if (!raw?.trim()) continue;
      const { frontmatter, body } = parseAgentMarkdown(raw);
      const def = frontmatterToDefinition(frontmatter, body, source, filePath);
      if (def) agents.push(def);
    } catch {
      // skip unreadable files
    }
  }
  return agents;
}

async function getUserAgentsDir(): Promise<string | null> {
  try {
    return await invoke<string>('get_claude_user_agents_dir');
  } catch {
    return null;
  }
}

let cachedRegistry: Map<string, SubagentDefinition> | null = null;
let cacheKey = '';

export async function loadSubagentRegistry(
  projectPath?: string
): Promise<Map<string, SubagentDefinition>> {
  const key = projectPath || '';
  if (cachedRegistry && cacheKey === key) return cachedRegistry;

  const merged = new Map<string, SubagentDefinition>();

  for (const builtin of BUILTIN_SUBAGENTS) {
    merged.set(builtin.name, { ...builtin });
  }

  const userDir = await getUserAgentsDir();
  if (userDir) {
    const userAgents = await loadAgentsFromDir(userDir, 'user');
    for (const agent of userAgents) {
      merged.set(agent.name, agent);
    }
  }

  if (projectPath?.trim()) {
    const projectDir = joinPath(projectPath, AGENTS_DIR);
    const projectAgents = await loadAgentsFromDir(projectDir, 'project');
    for (const agent of projectAgents) {
      merged.set(agent.name, agent);
    }
  }

  cachedRegistry = merged;
  cacheKey = key;
  return merged;
}

export function invalidateSubagentRegistry(): void {
  cachedRegistry = null;
  cacheKey = '';
}

export async function getSubagentDefinition(
  name: string,
  projectPath?: string
): Promise<SubagentDefinition | undefined> {
  const registry = await loadSubagentRegistry(projectPath);
  return registry.get(name) ?? registry.get(name.toLowerCase());
}

export async function listSubagentDefinitions(projectPath?: string): Promise<SubagentDefinition[]> {
  const registry = await loadSubagentRegistry(projectPath);
  return Array.from(registry.values());
}

export function resolveSubagentTypeName(raw?: string): string {
  if (!raw?.trim()) return 'general-purpose';
  const normalized = raw.trim();
  const aliases: Record<string, string> = {
    explore: 'Explore',
    plan: 'Plan',
    'general-purpose': 'general-purpose',
    general: 'general-purpose',
    bash: 'general-purpose',
    verification: 'general-purpose',
  };
  return aliases[normalized.toLowerCase()] ?? normalized;
}
