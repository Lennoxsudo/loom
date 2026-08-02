/**
 * Agent Memory tool handler (add / replace / remove) — user-scoped, not project memory.
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler } from '../types';
import type { AgentMemoryArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import {
  applyAgentMemoryMutation,
  charLimitForTarget,
  formatLiveEntriesSummary,
  loadAgentMemoryEntries,
  mutateAgentMemoryStore,
  type AgentMemoryFlags,
} from '../../../utils/agentMemory';
import { stageAgentMemoryPending } from '../../../utils/agentMemoryPending';
import { formatAgentMemoryStagedOutput } from '../../../utils/agentMemoryPendingUi';
import { useSettingsStore } from '../../../stores/useSettingsStore';

function readFlags(): AgentMemoryFlags {
  const s = useSettingsStore.getState();
  return {
    enableAgentMemory: s.enableAgentMemory,
    enableAgentMemoryUserProfile: s.enableAgentMemoryUserProfile,
    enableAgentMemoryNotes: s.enableAgentMemoryNotes,
  };
}

class AgentMemoryHandler implements ToolHandler<'agent_memory'> {
  name = 'agent_memory' as const;

  async execute(args: AgentMemoryArgs): Promise<ToolResult> {
    try {
      const action = args.action;
      const target = args.target;
      if (!action) throw ToolError.missingParam('action');
      if (!target) throw ToolError.missingParam('target');
      if (action !== 'add' && action !== 'replace' && action !== 'remove') {
        throw ToolError.invalidParam('action', 'must be add | replace | remove');
      }
      if (target !== 'user' && target !== 'memory') {
        throw ToolError.invalidParam('target', "must be 'user' | 'memory'");
      }

      if (action === 'add' || action === 'replace') {
        if (!args.content?.trim()) throw ToolError.missingParam('content');
      }
      if (action === 'replace') {
        if (!args.old_text?.trim()) throw ToolError.missingParam('old_text');
      }

      const removeNeedle =
        action === 'remove'
          ? (args.old_text?.trim() || args.content?.trim() || '')
          : undefined;

      const flags = readFlags();
      if (!flags.enableAgentMemory) {
        return {
          tool_call_id: '',
          output: '',
          error: 'Agent Memory is disabled in settings',
        };
      }
      if (target === 'user' && !flags.enableAgentMemoryUserProfile) {
        return {
          tool_call_id: '',
          output: '',
          error: 'User profile memory is disabled in settings',
        };
      }
      if (target === 'memory' && !flags.enableAgentMemoryNotes) {
        return {
          tool_call_id: '',
          output: '',
          error: 'Agent notes memory is disabled in settings',
        };
      }

      if (action === 'remove' && !removeNeedle) {
        const entries = await loadAgentMemoryEntries(target);
        return {
          tool_call_id: '',
          output: '',
          error: [
            'old_text (or content) is required for action=remove — pass a unique substring of the entry to delete.',
            formatLiveEntriesSummary(target, entries),
            entries.length
              ? `current_entries:\n${entries.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        };
      }

      const oldTextForWrite =
        action === 'remove' ? removeNeedle : args.old_text;

      // Write-approval: probe add for exact/near-dup before staging; other actions stage as-is.
      if (useSettingsStore.getState().agentMemoryWriteApproval) {
        if (action === 'add') {
          const entries = await loadAgentMemoryEntries(target);
          const probe = applyAgentMemoryMutation(entries, 'add', {
            content: args.content,
            limit: charLimitForTarget(target),
          });
          if (!probe.ok) {
            return {
              tool_call_id: '',
              output: '',
              error: [probe.error, formatLiveEntriesSummary(target, entries)]
                .filter(Boolean)
                .join('\n\n'),
            };
          }
          if (probe.entries.length === entries.length) {
            return {
              tool_call_id: '',
              output: `${probe.message ?? 'OK'}\n\n${formatLiveEntriesSummary(target, entries)}`,
            };
          }
        }

        const staged = await stageAgentMemoryPending({
          action,
          target,
          content: args.content,
          oldText: oldTextForWrite,
          reason: 'tool',
        });
        return {
          tool_call_id: '',
          output: formatAgentMemoryStagedOutput({
            pendingId: staged.id,
            action: staged.action,
            target: staged.target,
            content: staged.content,
            oldText: staged.oldText,
          }),
        };
      }

      const result = await mutateAgentMemoryStore(target, action, {
        content: args.content,
        oldText: oldTextForWrite,
        flags,
      });

      if (!result.ok) {
        const detail = [
          result.error ?? 'Agent memory write failed',
          result.liveSummary,
          result.entries.length
            ? `current_entries:\n${result.entries.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        return { tool_call_id: '', output: '', error: detail };
      }

      return {
        tool_call_id: '',
        output: `${result.message ?? 'OK'}\n\n${result.liveSummary}`,
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const agentMemoryHandlers: ToolHandler[] = [new AgentMemoryHandler()];
