import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { RunSubagentArgs, RunSubagentsArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { getAgent, type AIProvider } from '../../../utils/agentPersistence';
import type { SubagentResult } from '../../../types/subagent';
import { isSubagentsEnabled, SUBAGENT_DISABLED_SUMMARY } from '../../../utils/subagents/bootstrap';
import { resolveSubagentTypeName } from '../../../utils/subagents/registry';

/** Lazy import breaks registry ↔ spawn ↔ runAgentLoop ↔ agent-engine cycle at module load time. */
async function loadSpawnSubagent() {
  const mod = await import('../../../utils/subagents/spawn');
  return mod.spawnSubagent;
}

function formatSubagentToolResult(result: SubagentResult): ToolResult {
  if (result.status === 'succeeded') {
    return { tool_call_id: '', output: result.summary };
  }
  const statusText = result.status === 'cancelled' ? '取消' : '失败';
  const reasonText =
    result.status === 'cancelled'
      ? '已被用户取消'
      : result.truncated
        ? '达到最大工具调用轮次'
        : result.error || '未知错误';
  return {
    tool_call_id: '',
    output: `子代理运行${statusText}。失败原因：${reasonText}\n摘要: ${result.summary}`,
    error: result.error || `Subagent execution ${result.status}`,
  };
}

async function resolveParentContext(context?: ToolContext) {
  const parentAgent = await getAgent();
  const provider = (context?.parentProvider || parentAgent?.provider || 'openai') as AIProvider;
  const model = context?.parentModel || parentAgent?.model || '';
  return { provider, model };
}

export class RunSubagentHandler implements ToolHandler<'run_subagent'> {
  name = 'run_subagent' as const;

  async execute(args: RunSubagentArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.task || args.task.trim().length === 0) {
        throw ToolError.missingParam('task');
      }

      const { provider, model } = await resolveParentContext(context);
      const taskId =
        context?.toolCallId || `sub-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const subagentType = resolveSubagentTypeName(
        args.subagent_type || args.preset || 'general-purpose'
      );

      const spawnOptions = {
        taskId,
        prompt: args.task,
        subagentType,
        context: args.context,
        model: args.model || 'inherit',
        allowedTools: args.allowed_tools,
        maxToolRounds: args.max_tool_rounds,
        contextBudget: args.context_budget,
        async: args.async,
        parentProvider: provider,
        parentModel: model,
        parentContext: context,
        parentToolNames: context?.parentToolNames,
      };

      if (!isSubagentsEnabled()) {
        return { tool_call_id: '', output: SUBAGENT_DISABLED_SUMMARY };
      }

      const spawnSubagent = await loadSpawnSubagent();

      if (args.async) {
        spawnSubagent(spawnOptions).catch((err) => {
          console.error('Async subagent execution error:', err);
        });
        return {
          tool_call_id: '',
          output: `子代理已在后台启动。子代理 ID: ${taskId} / Subagent started in background. Subagent ID: ${taskId}`,
        };
      }

      const result = await spawnSubagent(spawnOptions);
      return formatSubagentToolResult(result);
    } catch (error) {
      if (error instanceof ToolError) return error.toToolResult();
      return handleToolError(error);
    }
  }
}

export class RunSubagentsHandler implements ToolHandler<'run_subagents'> {
  name = 'run_subagents' as const;

  async execute(args: RunSubagentsArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.tasks || !Array.isArray(args.tasks) || args.tasks.length === 0) {
        throw ToolError.missingParam('tasks');
      }

      if (!isSubagentsEnabled()) {
        return { tool_call_id: '', output: SUBAGENT_DISABLED_SUMMARY };
      }

      const { provider, model } = await resolveParentContext(context);

      const spawnSubagent = await loadSpawnSubagent();

      const results = await Promise.all(
        args.tasks.map(async (taskArg, index) => {
          const rand = Math.random().toString(36).substring(2, 6);
          const subTaskId = `${context?.toolCallId || 'sub'}-${index}-${rand}`;
          const subagentType = resolveSubagentTypeName(
            taskArg.subagent_type || taskArg.preset || 'general-purpose'
          );

          return spawnSubagent({
            taskId: subTaskId,
            prompt: taskArg.task,
            subagentType,
            context: taskArg.context,
            model: taskArg.model || 'inherit',
            allowedTools: taskArg.allowed_tools,
            maxToolRounds: taskArg.max_tool_rounds,
            contextBudget: taskArg.context_budget,
            parentProvider: provider,
            parentModel: model,
            parentContext: context,
            parentToolNames: context?.parentToolNames,
          });
        })
      );

      const total = results.length;
      const succeededCount = results.filter((r) => r && r.status === 'succeeded').length;
      const cancelledCount = results.filter((r) => r && r.status === 'cancelled').length;
      const failedCount = total - succeededCount - cancelledCount;

      let output = `并行子代理结果（共 ${total} 个，成功 ${succeededCount} / 失败 ${failedCount} / 取消 ${cancelledCount}）：\n`;

      results.forEach((res, index) => {
        const originalTask = args.tasks[index];
        const statusLabel =
          res?.status === 'succeeded' ? '成功' : res?.status === 'cancelled' ? '已取消' : '失败';
        output += `\n【子代理 ${index + 1} · ${statusLabel}】${originalTask.task}\n`;
        if (res?.summary) {
          output += `${res.summary}\n`;
        } else if (res?.error) {
          output += `错误：${res.error}\n`;
        } else {
          output += `未知错误\n`;
        }
      });

      return { tool_call_id: '', output };
    } catch (error) {
      if (error instanceof ToolError) return error.toToolResult();
      return handleToolError(error);
    }
  }
}

export const subagentHandlers = [new RunSubagentHandler(), new RunSubagentsHandler()];
