import { invoke } from '@tauri-apps/api/core';
import type { AIProvider } from '../agentPersistence';
import { parseProviderAndModel } from '../parseProviderAndModel';
import { reconcileProviderRequest, type LoadedAiConfig } from '../aiProviderRuntime';
import { runAgentLoop, buildForkMessages, filterToolsForSubagentType } from '../runAgentLoop';
import { loadSkillsContext, loadSkillContent } from '../skills';
import { estimateTokens } from '../contextBudget';
import { getSubagentSystemPrompt } from '../../features/agent-engine/subagentPrompt';
import type { ToolContext } from '../../features/agent-engine/types';
import type { SubagentResult, SubagentMetrics } from '../../types/subagent';
import type { ChatMessage } from '../../types/chat';
import { useSubagentStore } from '../../stores/useSubagentStore';
import type { AgentAccessMode } from '../../types/settings';
import { getSubagentDefinition, resolveSubagentTypeName } from './registry';
import { resolveModelAlias } from './modelAliases';
import { getContextPolicy, loadClaudeMd } from './contextPolicy';
import { parseSubagentResult } from './resultParser';
import {
  filterSpawnTools,
  mapClaudeToolNames,
  resolveSubagentToolDefinitions,
  resolveSubagentToolNames,
} from './toolMapping';
import { canForkAtDepth, canSpawnSubagent } from './nesting';
import { runSubagentHooks } from './hooks';
import type { SpawnSubagentOptions, SubagentDefinition, SubagentPermissionMode } from './types';
import {
  bootstrapSubagentFromToolArgs,
  buildSubagentTaskFromToolArgs,
  buildSubagentDisabledResult,
  isSubagentsEnabled,
} from './bootstrap';
import {
  resolveSubagentContextTokensForLoop,
  resolveSubagentContextTruncationBudget,
  resolveSubagentMaxRounds,
} from './spawnPolicy';

async function resolveProviderAndModel(
  modelName: string | undefined,
  defaultProvider: AIProvider,
  defaultModel: string
): Promise<{ provider: AIProvider; model: string; warning?: string }> {
  const inherited = resolveModelAlias(modelName, defaultModel);
  const parsed = parseProviderAndModel(inherited);
  if (!modelName || modelName === 'inherit' || inherited === defaultModel) {
    return { provider: defaultProvider, model: parsed.model };
  }

  let config: any = null;
  try {
    const configStr = await invoke<string>('load_ai_config');
    if (configStr) config = JSON.parse(configStr);
  } catch {
    // ignore
  }

  if (config) {
    for (const provider of ['openai', 'anthropic', 'ollama']) {
      const profiles = config.profiles?.[provider];
      if (profiles?.items) {
        for (const profile of profiles.items) {
          if (profile.apiKey?.trim()) {
            if (profile.models?.includes(modelName) || profile.model === modelName) {
              return { provider: provider as AIProvider, model: modelName };
            }
          }
        }
      }
      const pConfig = config.configs?.[provider];
      if (pConfig?.apiKey?.trim()) {
        if (pConfig.model === modelName || pConfig.models?.includes(modelName)) {
          return { provider: provider as AIProvider, model: modelName };
        }
      }
    }
  }

  const warning = `指定的模型 "${modelName}" 未在已配置的 AI 服务商中找到，已回退到主代理模型。 / The specified model "${modelName}" was not found in the configured AI providers, falling back to the parent agent model.`;
  const parentParsed = parseProviderAndModel(defaultModel);
  return { provider: defaultProvider, model: parentParsed.model, warning };
}

function mapPermissionMode(mode?: SubagentPermissionMode): AgentAccessMode | undefined {
  if (!mode || mode === 'default') return undefined;
  if (mode === 'plan' || mode === 'dontAsk') return 'read_only';
  if (mode === 'bypassPermissions' || mode === 'acceptEdits' || mode === 'auto')
    return 'full_access';
  return undefined;
}

async function resolveWorktreeBaseDir(
  projectPath: string,
  isolation?: string
): Promise<{ baseDir: string; worktreePath?: string }> {
  if (isolation !== 'worktree' || !projectPath.trim()) {
    return { baseDir: projectPath };
  }
  try {
    const worktreePath = await invoke<string>('create_subagent_worktree', { projectPath });
    return { baseDir: worktreePath, worktreePath };
  } catch {
    return { baseDir: projectPath };
  }
}

async function cleanupWorktree(
  worktreePath: string | undefined,
  hadChanges: boolean
): Promise<void> {
  if (!worktreePath) return;
  try {
    await invoke('cleanup_subagent_worktree', { worktreePath, hadChanges });
  } catch {
    // ignore cleanup errors
  }
}

export async function spawnSubagent(options: SpawnSubagentOptions): Promise<SubagentResult> {
  if (!isSubagentsEnabled()) {
    return buildSubagentDisabledResult(options.taskId);
  }

  bootstrapSubagentFromToolArgs(options.taskId, {
    prompt: options.prompt,
    subagent_type: options.subagentType,
    context: options.context,
    model: options.model,
    spawn_mode: options.spawnMode,
    resume: options.spawnMode === 'fork' ? 'self' : undefined,
  });

  const store = useSubagentStore.getState();
  const typeName = resolveSubagentTypeName(options.subagentType);
  const def = await getSubagentDefinition(typeName, options.parentContext?.baseDir);
  if (!def) {
    const result = {
      taskId: options.taskId,
      status: 'failed' as const,
      summary: `未找到子代理定义: ${typeName}`,
      error: 'Unknown subagent type',
    };
    store.finishSubagent(options.taskId, result);
    return result;
  }

  const depth = options.parentContext?.subagentDepth ?? 0;
  const background = options.async ?? def.background ?? false;

  if (!canSpawnSubagent(depth, background)) {
    const result = {
      taskId: options.taskId,
      status: 'failed' as const,
      summary: '后台子代理已达到最大嵌套深度，无法继续 spawn。',
      error: 'Max nested depth reached',
    };
    store.finishSubagent(options.taskId, result);
    return result;
  }

  const spawnMode = options.spawnMode ?? 'isolated';
  if (!canForkAtDepth(depth, spawnMode)) {
    const result = {
      taskId: options.taskId,
      status: 'failed' as const,
      summary: 'Fork 子代理不能嵌套 fork。',
      error: 'Fork cannot nest fork',
    };
    store.finishSubagent(options.taskId, result);
    return result;
  }

  return runOneSubagentWithDefinition(options, def, typeName);
}

async function runOneSubagentWithDefinition(
  options: SpawnSubagentOptions,
  def: SubagentDefinition,
  typeName: string
): Promise<SubagentResult> {
  const parentProvider = (options.parentProvider || 'openai') as AIProvider;
  const parentModel = options.parentModel || '';
  const depth = options.parentContext?.subagentDepth ?? 0;
  const spawnMode = options.spawnMode ?? 'isolated';

  const subConversationId = `sub-conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const parentToolNames = options.parentToolNames ?? [];
  let allowedNames: string[];
  if (options.allowedTools?.length) {
    allowedNames = mapClaudeToolNames(options.allowedTools);
  } else {
    allowedNames = resolveSubagentToolNames(def, parentToolNames);
  }
  allowedNames = filterSpawnTools(allowedNames, def.canNest ?? false);

  const { baseDir: worktreeBase, worktreePath } = await resolveWorktreeBaseDir(
    options.parentContext?.baseDir || '',
    def.isolation
  );

  const subContext: ToolContext = {
    ...options.parentContext,
    baseDir: worktreeBase || options.parentContext?.baseDir,
    conversationId: subConversationId,
    toolCallId: undefined,
    subagentDepth: depth + 1,
    spawnMode: 'isolated',
    parentProvider,
    parentModel,
    maxContextTokens: resolveSubagentContextTokensForLoop({
      contextBudget: options.contextBudget,
      parentContext: options.parentContext,
    }),
    parentToolNames,
    parentMcpTools: options.parentContext?.parentMcpTools,
    subagentPermissionMode: mapPermissionMode(def.permissionMode),
  };

  const policy = getContextPolicy(def);
  const promptParts: string[] = [getSubagentSystemPrompt(def.prompt)];

  if (policy.injectClaudeMd) {
    const claudeMd = await loadClaudeMd(options.parentContext?.baseDir);
    if (claudeMd) promptParts.push(claudeMd);
  }

  if (def.skills?.length) {
    for (const skillName of def.skills) {
      try {
        const content = await loadSkillContent(skillName, options.parentContext?.baseDir || '');
        if (content) promptParts.push(`## Skill: ${skillName}\n\n${content}`);
      } catch {
        // skip missing skills
      }
    }
  }

  let finalSystemPrompt = promptParts.join('\n\n');
  const resolvedTools = resolveSubagentToolDefinitions(
    allowedNames,
    options.parentContext?.parentMcpTools
  );

  // 方法 14：根据子代理类型裁剪工具集，减少工具定义 token 占用。
  // research 类只保留只读工具，coder 类保留读写工具，其他类型不裁剪。
  const filteredTools = filterToolsForSubagentType(resolvedTools, def.name);

  const modelToResolve = options.model || def.model || 'inherit';
  const resolvedModel = await resolveProviderAndModel(modelToResolve, parentProvider, parentModel);
  let provider = resolvedModel.provider;
  let model = resolvedModel.model;
  const warning = resolvedModel.warning;

  let resolvedProfileId = options.parentContext?.profileId;
  try {
    const configStr = await invoke<string>('load_ai_config');
    if (configStr) {
      const reconciled = reconcileProviderRequest(
        JSON.parse(configStr) as LoadedAiConfig,
        provider,
        model,
        resolvedProfileId
      );
      provider = reconciled.provider;
      model = reconciled.model;
      resolvedProfileId = reconciled.profileId;
    }
  } catch {
    // keep resolved provider/model when config cannot be loaded
  }

  if (!model) {
    throw new Error('无法确定子代理模型：主聊天未提供当前模型，且未指定有效 model。');
  }

  const truncationBudget = resolveSubagentContextTruncationBudget({
    contextBudget: options.contextBudget,
  });
  let finalContext = options.context || '';
  let contextTruncated = false;
  const description = options.prompt;
  const descriptionTokens = estimateTokens(description);
  const sysPromptTokens = estimateTokens(finalSystemPrompt);

  if (truncationBudget !== null) {
    const maxContextTokensAllowed = truncationBudget - descriptionTokens - sysPromptTokens - 1000;

    if (finalContext && estimateTokens(finalContext) > maxContextTokensAllowed) {
      contextTruncated = true;
      let low = 0;
      let high = finalContext.length;
      let bestLen = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (estimateTokens(finalContext.substring(0, mid)) <= maxContextTokensAllowed) {
          bestLen = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      finalContext =
        finalContext.substring(0, bestLen) +
        '\n... [上下文已按预算截断 / Context truncated by budget]';
    }
  }

  if (contextTruncated) {
    finalSystemPrompt = `[WARNING: 上下文已按预算截断 / Context truncated by budget]\n\n${finalSystemPrompt}`;
  }

  const initialUserMessage = finalContext
    ? contextTruncated
      ? `${description}\n\n[WARNING: 上下文已按预算截断 / Context truncated by budget]\n\n上下文背景：\n${finalContext}`
      : `${description}\n\n上下文背景：\n${finalContext}`
    : description;

  const maxRounds = resolveSubagentMaxRounds(options, def);

  const store = useSubagentStore.getState();
  const startedAt = Date.now();

  const task = buildSubagentTaskFromToolArgs(options.taskId, {
    prompt: description,
    subagent_type: typeName,
    context: options.context,
    model: modelToResolve,
    max_tool_rounds: maxRounds,
    spawn_mode: spawnMode,
    allowed_tools: allowedNames,
  });
  task.color = def.color;
  task.parentTaskId = options.parentContext?.spawnParentTaskId;
  task.allowedTools = allowedNames;
  task.maxToolRounds = maxRounds;
  task.model = modelToResolve;

  store.startSubagent(task);
  store.updateSubagentStatus(options.taskId, 'running', 0);
  await runSubagentHooks('SubagentStart', { taskId: options.taskId, subagentType: typeName });

  const controller = new AbortController();
  store.registerController(options.taskId, controller);

  let forkMessages: ChatMessage[] | undefined;
  if (spawnMode === 'fork' && options.parentContext?.parentMessages?.length) {
    // 方法 13：fork 时只传递摘要 + 最近 2 轮，而非全部父会话历史。
    // 子代理任务通常范围窄，不需要完整历史，这样启动更快、token 消耗更少。
    forkMessages = buildForkMessages(options.parentContext.parentMessages);
  }

  try {
    const loopResult = await runAgentLoop({
      systemPrompt: finalSystemPrompt,
      initialUserMessage,
      initialMessages: forkMessages,
      tools: filteredTools,
      model,
      provider,
      context: {
        ...subContext,
        profileId: resolvedProfileId ?? subContext.profileId,
      },
      maxRounds,
      signal: controller.signal,
      taskId: options.taskId,
      skillsContext: policy.injectSkillsIndex
        ? await loadSkillsContext(options.parentContext?.baseDir || '')
        : undefined,
      onEvent: (e) => {
        if (e.type === 'chunk') {
          if (e.chunkType === 'thinking') {
            store.appendThinking(options.taskId, e.chunk || '');
          } else {
            store.appendStreamChunk(options.taskId, e.chunk || '');
          }
        } else if (e.type === 'tool-start' && e.toolCallId && e.toolName) {
          const currentSteps = store.runs[options.taskId]?.steps || 0;
          store.updateSubagentStatus(options.taskId, 'running', currentSteps + 1);
          store.pushToolEvent(options.taskId, {
            id: e.toolCallId,
            toolName: e.toolName,
            status: 'running',
          });
        } else if (e.type === 'tool-end' && e.toolCallId) {
          const preview = e.toolResult?.error || e.toolResult?.output || '';
          store.updateToolEvent(options.taskId, e.toolCallId, {
            status: e.toolResult?.error ? 'error' : 'done',
            resultPreview: preview.length > 200 ? preview.slice(0, 200) + '...' : preview,
          });
        }
      },
    });

    store.removeController(options.taskId);
    const finishedAt = Date.now();
    const metrics: SubagentMetrics = {
      durationMs: finishedAt - startedAt,
      steps: loopResult.steps,
      promptTokens: loopResult.promptTokens,
      completionTokens: loopResult.completionTokens,
      totalTokens: loopResult.promptTokens + loopResult.completionTokens,
    };

    if (loopResult.truncated) {
      const summaryText = warning
        ? `${warning}\n\n因达到最大轮次被截断。${loopResult.finalText || ''}`
        : `因达到最大轮次被截断。${loopResult.finalText || ''}`;
      const parsed = parseSubagentResult(summaryText);
      const result: SubagentResult = {
        taskId: options.taskId,
        status: 'failed',
        truncated: true,
        summary: parsed.summary,
        artifacts: parsed.artifacts,
        assumptions: parsed.assumptions,
        error: 'Reached maximum tool call rounds',
        metrics,
      };
      store.updateSubagentStatus(options.taskId, 'failed', loopResult.steps);
      store.finishSubagent(options.taskId, result);
      await runSubagentHooks('SubagentStop', {
        taskId: options.taskId,
        subagentType: typeName,
        status: 'failed',
      });
      await cleanupWorktree(worktreePath, true);
      return result;
    }

    const parsed = parseSubagentResult(
      warning ? `${warning}\n\n${loopResult.finalText}` : loopResult.finalText
    );
    const result: SubagentResult = {
      taskId: options.taskId,
      status: 'succeeded',
      summary: parsed.summary,
      artifacts: parsed.artifacts,
      assumptions: parsed.assumptions,
      metrics,
    };
    store.updateSubagentStatus(options.taskId, 'succeeded', loopResult.steps);
    store.finishSubagent(options.taskId, result);
    await runSubagentHooks('SubagentStop', {
      taskId: options.taskId,
      subagentType: typeName,
      status: 'succeeded',
    });
    await cleanupWorktree(worktreePath, !!parsed.artifacts?.length);
    return result;
  } catch (loopError) {
    store.removeController(options.taskId);
    const finishedAt = Date.now();
    const isAborted =
      controller.signal.aborted ||
      (loopError instanceof Error && loopError.message.includes('aborted by user'));
    const currentRun = store.runs[options.taskId];
    const steps = currentRun?.steps || 0;
    const partialMetrics: SubagentMetrics = {
      durationMs: finishedAt - startedAt,
      steps,
      promptTokens: estimateTokens(finalSystemPrompt),
      completionTokens: estimateTokens(currentRun?.streamingText || ''),
      totalTokens: 0,
    };
    partialMetrics.totalTokens = partialMetrics.promptTokens + partialMetrics.completionTokens;

    if (isAborted) {
      const result: SubagentResult = {
        taskId: options.taskId,
        status: 'cancelled',
        summary: '已被用户取消。',
        error: 'Subagent loop aborted by user',
        metrics: partialMetrics,
      };
      store.updateSubagentStatus(options.taskId, 'cancelled', steps);
      store.finishSubagent(options.taskId, result);
      await runSubagentHooks('SubagentStop', {
        taskId: options.taskId,
        subagentType: typeName,
        status: 'cancelled',
      });
      await cleanupWorktree(worktreePath, false);
      return result;
    }

    const errMsg = loopError instanceof Error ? loopError.message : String(loopError);
    const result: SubagentResult = {
      taskId: options.taskId,
      status: 'failed',
      summary: `子代理运行错误: ${errMsg}`,
      error: errMsg,
      metrics: partialMetrics,
    };
    store.updateSubagentStatus(options.taskId, 'failed', steps);
    store.finishSubagent(options.taskId, result);
    await runSubagentHooks('SubagentStop', {
      taskId: options.taskId,
      subagentType: typeName,
      status: 'failed',
    });
    await cleanupWorktree(worktreePath, false);
    return result;
  }
}
