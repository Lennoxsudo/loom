import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invalidateSubagentRegistry, loadSubagentRegistry } from '../registry';
import { BUILTIN_SUBAGENTS } from '../builtins';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

describe('SubagentRegistry', () => {
  beforeEach(() => {
    invalidateSubagentRegistry();
  });

  it('loads builtin agents by default', async () => {
    const registry = await loadSubagentRegistry();
    expect(registry.has('Explore')).toBe(true);
    expect(registry.has('Plan')).toBe(true);
    expect(registry.has('general-purpose')).toBe(true);
    expect(registry.size).toBeGreaterThanOrEqual(BUILTIN_SUBAGENTS.length);
  });

  it('project agents override builtin names with same key', async () => {
    invalidateSubagentRegistry();
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      const a = args as { folderPath?: string; filePath?: string } | undefined;
      if (cmd === 'read_folder_children') {
        if (a?.folderPath?.includes('.claude/agents')) {
          return [{ name: 'custom.md', is_dir: false, path: '/proj/.claude/agents/custom.md' }];
        }
        return [];
      }
      if (cmd === 'read_file_content') {
        return `---
name: Explore
description: Custom explore override
---
Custom body`;
      }
      return null;
    });

    const registry = await loadSubagentRegistry('/proj');
    const explore = registry.get('Explore');
    expect(explore?.source).toBe('project');
    expect(explore?.description).toBe('Custom explore override');
  });
});
