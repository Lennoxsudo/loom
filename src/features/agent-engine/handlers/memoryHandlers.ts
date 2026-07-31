/**
 * Project Memory tool handler (list / get / upsert / delete).
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { MemoryArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import {
  deleteProjectMemory,
  getProjectMemoryEntry,
  loadProjectMemoryEntries,
  upsertProjectMemory,
  type ProjectMemoryEntry,
} from '../../../utils/projectMemory';

function formatEntry(entry: ProjectMemoryEntry): string {
  const tags = entry.tags.length ? ` [${entry.tags.join(', ')}]` : '';
  return [`### ${entry.title}${tags}`, `id: ${entry.id}`, entry.body.trim()].join('\n');
}

class MemoryHandler implements ToolHandler<'memory'> {
  name = 'memory' as const;

  async execute(args: MemoryArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const projectPath = context?.baseDir?.trim() || '';
      if (!projectPath) {
        throw ToolError.invalidParam('baseDir', 'project path is required for memory');
      }

      const action = args.action;
      if (!action) {
        throw ToolError.missingParam('action');
      }

      if (action === 'list') {
        const entries = await loadProjectMemoryEntries(projectPath);
        if (entries.length === 0) {
          return { tool_call_id: '', output: 'No project memory entries.' };
        }
        const lines = entries.map((e) => {
          const tags = e.tags.length ? ` tags=[${e.tags.join(', ')}]` : '';
          return `- ${e.id}: ${e.title}${tags}`;
        });
        return {
          tool_call_id: '',
          output: `Project memory (${entries.length}):\n${lines.join('\n')}`,
        };
      }

      if (action === 'get') {
        const id = args.id?.trim();
        if (!id) throw ToolError.missingParam('id');
        const entry = await getProjectMemoryEntry(projectPath, id);
        if (!entry) {
          return { tool_call_id: '', output: '', error: `Memory entry not found: ${id}` };
        }
        return { tool_call_id: '', output: formatEntry(entry) };
      }

      if (action === 'upsert') {
        const title = args.title?.trim();
        const body = args.body?.trim();
        if (!title) throw ToolError.missingParam('title');
        if (!body) throw ToolError.missingParam('body');
        const entry = await upsertProjectMemory(projectPath, {
          id: args.id?.trim() || undefined,
          title,
          body,
          tags: args.tags,
        });
        return {
          tool_call_id: '',
          output: `Saved project memory:\n${formatEntry(entry)}`,
        };
      }

      if (action === 'delete') {
        const id = args.id?.trim();
        if (!id) throw ToolError.missingParam('id');
        const ok = await deleteProjectMemory(projectPath, id);
        if (!ok) {
          return { tool_call_id: '', output: '', error: `Memory entry not found: ${id}` };
        }
        return { tool_call_id: '', output: `Deleted project memory: ${id}` };
      }

      throw ToolError.invalidParam('action', 'must be list | get | upsert | delete');
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const memoryHandlers: ToolHandler[] = [new MemoryHandler()];
