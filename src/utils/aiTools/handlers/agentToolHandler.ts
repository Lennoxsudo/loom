import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { AgentToolArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { getAgent, type AIProvider } from '../../agentPersistence';
import { spawnSubagent } from '../../subagents/spawn';
import { isSubagentsEnabled, SUBAGENT_DISABLED_SUMMARY } from '../../subagents/bootstrap';
import { resolveSubagentTypeName } from '../../subagents/registry';

function formatSubagentToolResult(result: Awaited<ReturnType<typeof spawnSubagent>>): ToolResult {
  if (result.status === 'succeeded') {
    let output = result.summary;
    if (result.artifacts?.length) {
      output += `\n\nArtifacts:\n${result.artifacts.map((a) => `- [${a.type}] ${a.ref}${a.note ? `: ${a.note}` : ''}`).join('\n')}`;
    }
    if (result.assumptions?.length) {
      output += `\n\nAssumptions:\n${result.assumptions.map((a) => `- ${a}`).join('\n')}`;
    }
    return { tool_call_id: '', output };
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

async function executeAgentTool(
  args: AgentToolArgs,
  context?: ToolContext
): Promise<ToolResult> {
  if (!args.prompt || String(args.prompt).trim().length === 0) {
    throw ToolError.missingParam('prompt');
  }

  const parentAgent = await getAgent();

  const parentProvider = (context?.parentProvider || parentAgent?.provider || 'openai') as AIProvider;
  const parentModel = context?.parentModel || parentAgent?.model || '';
  const taskId =
    context?.toolCallId || `sub-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const subagentType = resolveSubagentTypeName(args.subagent_type);
  const spawnMode =
    args.resume === 'self' || args.spawn_mode === 'fork' ? ('fork' as const) : ('isolated' as const);

  const spawnOptions = {
    taskId,
    prompt: String(args.prompt),
    subagentType,
    context: args.context,
    model: args.model,
    allowedTools: args.allowed_tools,
    maxToolRounds: args.max_tool_rounds,
    contextBudget: args.context_budget,
    async: args.run_in_background ?? args.async,
    spawnMode,
    parentProvider,
    parentModel,
    parentContext: context,
    parentToolNames: context?.parentToolNames,
  };

  if (!isSubagentsEnabled()) {
    return { tool_call_id: '', output: SUBAGENT_DISABLED_SUMMARY };
  }

  if (spawnOptions.async) {
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
}

export class AgentToolHandler implements ToolHandler<'Agent'> {
  name = 'Agent' as const;

  async execute(args: AgentToolArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      return await executeAgentTool(args, context);
    } catch (error) {
      if (error instanceof ToolError) return error.toToolResult();
      return handleToolError(error);
    }
  }
}

export class TaskToolHandler implements ToolHandler<'Task'> {
  name = 'Task' as const;

  async execute(args: AgentToolArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      return await executeAgentTool(args, context);
    } catch (error) {
      if (error instanceof ToolError) return error.toToolResult();
      return handleToolError(error);
    }
  }
}

export const agentToolHandlers = [new AgentToolHandler(), new TaskToolHandler()];
