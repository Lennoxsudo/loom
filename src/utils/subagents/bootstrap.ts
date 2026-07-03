import { useSettingsStore } from '../../stores/useSettingsStore';
import { useSubagentStore } from '../../stores/useSubagentStore';
import type { SubagentResult, SubagentTask } from '../../types/subagent';
import { resolveSubagentTypeName } from './registry';

export const SUBAGENT_DISABLED_SUMMARY =
  '子代理已禁用（当前为单 Agent 模式），请在主循环中串行完成任务 / Subagents are disabled (single-agent mode). Complete the work serially in the main loop.';

export function isSubagentsEnabled(): boolean {
  return useSettingsStore.getState().enableSubagents === true;
}

export function buildSubagentDisabledResult(taskId: string): SubagentResult {
  return { taskId, status: 'succeeded', summary: SUBAGENT_DISABLED_SUMMARY };
}

function readTaskDescription(args: Record<string, unknown>): string {
  const raw = args.prompt ?? args.task ?? args.description;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return '';
}

export function buildSubagentTaskFromToolArgs(
  taskId: string,
  args: Record<string, unknown>
): SubagentTask {
  const subagentType = resolveSubagentTypeName(
    typeof args.subagent_type === 'string'
      ? args.subagent_type
      : typeof args.preset === 'string'
        ? args.preset
        : 'general-purpose'
  );
  const spawnMode =
    args.resume === 'self' || args.spawn_mode === 'fork' ? ('fork' as const) : ('isolated' as const);

  return {
    id: taskId,
    description: readTaskDescription(args) || '子代理任务运行中…',
    context: typeof args.context === 'string' ? args.context : undefined,
    model: typeof args.model === 'string' ? args.model : undefined,
    maxToolRounds:
      typeof args.max_tool_rounds === 'number' ? args.max_tool_rounds : undefined,
    subagentType,
    spawnMode,
    allowedTools: Array.isArray(args.allowed_tools)
      ? args.allowed_tools.filter((t): t is string => typeof t === 'string')
      : undefined,
  };
}

/** Register a pending subagent run as soon as the tool call is accepted by the UI. */
export function bootstrapSubagentFromToolArgs(taskId: string, args: Record<string, unknown>): void {
  useSubagentStore.getState().startSubagent(buildSubagentTaskFromToolArgs(taskId, args));
}
