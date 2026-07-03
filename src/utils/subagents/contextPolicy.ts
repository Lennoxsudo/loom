import type { SubagentDefinition } from './types';

export interface ContextPolicy {
  injectClaudeMd: boolean;
  injectRules: boolean;
  injectSkillsIndex: boolean;
}

export function getContextPolicy(def: SubagentDefinition): ContextPolicy {
  return {
    injectClaudeMd: !def.skipClaudeMd,
    injectRules: !def.skipRules,
    injectSkillsIndex: !def.skipSkillsIndex,
  };
}

export async function loadClaudeMd(projectPath?: string): Promise<string> {
  if (!projectPath?.trim()) return '';
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const base = projectPath.replace(/[\\/]+$/, '');
  const candidates = [`${base}${sep}CLAUDE.md`, `${base}${sep}AGENTS.md`];

  for (const filePath of candidates) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const content = await invoke<string>('read_file_content', { filePath });
      if (content?.trim()) {
        return `# Project Instructions (CLAUDE.md)\n\n${content.trim()}`;
      }
    } catch {
      // try next
    }
  }
  return '';
}
