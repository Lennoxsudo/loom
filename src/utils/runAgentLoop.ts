import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage, ProviderRequestMessage } from '../types/chat';
import type { ToolDefinition, ToolResult } from '../types/ai';
import type { ToolCall } from '../features/agent-engine';
import { executeToolCall } from '../features/agent-engine';
import { toAnthropicTools, toOpenAITools } from '../features/agent-engine/converters';
import { subagentResourceLock } from '../features/agent-engine/subagentResourceLock';
import type { ToolContext } from '../features/agent-engine/types';
import {
  toProviderRequestMessages,
  buildContextForRequest,
} from '../components/agent/utils';
import { loadSkillsContext } from './skills';
import type { AIProvider } from './agentPersistence';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUsageStore } from '../stores/useUsageStore';
import { estimateMessageTokens, estimateTokens } from './contextBudget';
import { agePersistedChatToolMessages } from './toolResultAging';
import {
  shouldBlockTool,
  shouldRequestApproval,
} from './agentAccessMode';
import { requiresConfirmation } from './toolGuard';
import { resolveSubagentStreamToolCalls } from '../features/agent-engine/finalizeStreamToolCalls';
import { looksLikePseudoToolCall } from '../features/agent-engine/compatToolCalls';
import { beginSandboxExecution, endSandboxExecution } from './agentSandbox';

const DUPLICATE_TOOL_SKIP_MESSAGE =
  '已跳过重复工具调用：相同工具与参数在本子代理会话中已执行过。请根据上文已有结果直接输出最终结构化摘要，不要再调用工具。' +
  ' / Duplicate tool call skipped: this tool with the same arguments was already executed in this subagent session. Use the prior result above and respond with your final structured summary without further tool calls.';

const PSEUDO_TOOL_CORRECTION_MESSAGE =
  '检测到伪工具调用：请改用 API 原生 function calling / tool_calls 重新调用对应工具，不要把工具调用 JSON 写进正文。' +
  ' / Detected pseudo tool call in message body: use native function calling / tool_calls instead of writing tool invocation JSON in your reply.';

const MAX_PSEUDO_TOOL_CORRECTIONS = 2;

function parseToolCallArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`).join(',')}}`;
}

function buildToolCallFingerprint(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}\0${stableSerialize(args)}`;
}

async function resolveAppDataPath(): Promise<string | undefined> {
  try {
    const path = await invoke<string>('get_app_data_path');
    return path || undefined;
  } catch {
    return undefined;
  }
}

function formatToolsForProvider(provider: AIProvider, tools: ToolDefinition[]): unknown {
  if (tools.length === 0) return undefined;
  if (provider === 'anthropic') return toAnthropicTools(tools);
  return toOpenAITools(tools);
}

// ==================== 方法 13：子代理 fork 上下文优化 ====================

/** Fork 时保留的最近消息轮数（每轮 = user + assistant） */
const FORK_KEEP_RECENT_ROUNDS = 2;

/** 每轮消息数（user + assistant = 2 条，不含 tool 消息） */
const MESSAGES_PER_ROUND = 2;

/**
 * 方法 13：构建 fork 模式的子代理初始消息。
 *
 * 子代理任务通常范围窄，不需要完整父会话历史。
 * 将父消息拆分为：
 * - 摘要部分：较早的消息，用结构化摘要替代
 * - 最近部分：保留最近 N 轮的原始消息
 *
 * 这样子代理启动更快，token 消耗更少。
 *
 * @param parentMessages 父会话的消息数组
 * @param keepRounds 保留最近几轮原始消息（默认 2 轮 = 4 条）
 */
export function buildForkMessages(
  parentMessages: ChatMessage[],
  keepRounds = FORK_KEEP_RECENT_ROUNDS,
): ChatMessage[] {
  if (parentMessages.length === 0) return [];

  const keepCount = Math.min(keepRounds * MESSAGES_PER_ROUND, parentMessages.length);
  const recentMessages = parentMessages.slice(-keepCount);
  const olderMessages = parentMessages.slice(0, -keepCount);

  // 如果没有更早的消息，直接返回最近的
  if (olderMessages.length === 0) {
    return recentMessages;
  }

  // 为较早的消息构建结构化摘要
  const summary = buildParentContextSummary(olderMessages);

  const summaryMessage: ChatMessage = {
    id: `sub-fork-summary-${Date.now()}`,
    role: 'user',
    text: `[Parent Context Summary]\n${summary}`,
    createdAt: Date.now(),
  };

  return [summaryMessage, ...recentMessages];
}

/**
 * 从父会话消息中提取结构化摘要（用户意图、工具调用、关键结论）。
 * 复用 contextCompressor 的思路，但简化为子代理场景。
 */
function buildParentContextSummary(messages: ChatMessage[]): string {
  const userIntents: string[] = [];
  const toolCalls: string[] = [];
  const conclusions: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (text.trim()) {
        userIntents.push(text.slice(0, 120));
      }
    } else if (msg.role === 'assistant') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      // 提取工具调用
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const name = tc?.function?.name;
          if (typeof name === 'string' && name.trim()) {
            toolCalls.push(name);
          }
        }
      }
      // 结论取尾部
      if (text.trim()) {
        conclusions.push(text.trim().slice(-80));
      }
    }
  }

  const lines: string[] = [
    `Compressed from ${messages.length} earlier messages.`,
  ];

  if (userIntents.length > 0) {
    lines.push('');
    lines.push('## User Intents');
    for (const intent of userIntents.slice(0, 8)) {
      lines.push(`- ${intent.length > 120 ? intent.slice(0, 117) + '...' : intent}`);
    }
  }

  if (toolCalls.length > 0) {
    lines.push('');
    lines.push('## Tools Called');
    const counts = new Map<string, number>();
    for (const name of toolCalls) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    lines.push(
      [...counts.entries()]
        .map(([name, count]) => (count > 1 ? `${name} (×${count})` : name))
        .slice(0, 20)
        .join(', '),
    );
  }

  if (conclusions.length > 0) {
    lines.push('');
    lines.push('## Key Conclusions');
    for (const c of conclusions.slice(0, 5)) {
      lines.push(`- ${c.length > 80 ? c.slice(0, 77) + '...' : c}`);
    }
  }

  return lines.join('\n');
}

// ==================== 方法 14：子代理工具子集化 ====================

/**
 * 方法 14：子代理工具预设。
 *
 * 根据子代理类型自动裁剪工具集，减少工具定义的 token 占用。
 * - research 类：只读工具（read/search/glob/grep/get_file_tree）
 * - coder 类：读写工具（read/write/edit/search/glob/grep）
 * - 其他类：不做预设裁剪，由 agent 定义的 tools/disallowedTools 控制
 */
const TOOL_PRESETS: Record<string, Set<string>> = {
  research: new Set(['read', 'read_file', 'search', 'search_content', 'glob', 'grep', 'get_file_tree', 'list_directory', 'list_dir']),
  coder: new Set(['read', 'read_file', 'write', 'write_file', 'edit', 'edit_file', 'search', 'search_content', 'glob', 'grep', 'get_file_tree', 'list_directory', 'list_dir']),
};

/** 永远不需要的子代理工具（在所有预设中排除） */
const SUBAGENT_EXCLUDED_TOOLS = new Set(['generate_image', 'image_gen']);

/**
 * 方法 14：根据子代理类型裁剪工具定义。
 *
 * @param tools 原始工具定义列表
 * @param subagentType 子代理类型名称（如 "research", "coder"）
 * @returns 裁剪后的工具定义列表
 */
export function filterToolsForSubagentType<T extends { name: string }>(
  tools: T[],
  subagentType?: string,
): T[] {
  // 先排除子代理不需要的工具
  let result = tools.filter((t) => !SUBAGENT_EXCLUDED_TOOLS.has(t.name));

  // 如果有预设，只保留预设中的工具
  const preset = subagentType ? TOOL_PRESETS[subagentType] : undefined;
  if (preset) {
    const filtered = result.filter((t) => preset.has(t.name));
    // 安全兜底：如果过滤后为空，返回过滤前结果
    if (filtered.length > 0) {
      result = filtered;
    }
  }

  return result;
}

/** Estimate tokens for ChatMessages (text, tool_calls, attachments, thinking). */
function estimateChatMessagesTokens(msgs: ChatMessage[]): number {
  let total = 0;
  for (const msg of msgs) {
    const [providerMsg] = toProviderRequestMessages([msg]);
    total += estimateMessageTokens(providerMsg as { role: string; content: unknown });
    if (msg.thinking) {
      total += estimateTokens(msg.thinking);
    }
    if (msg.attachments?.length) {
      total += msg.attachments.length * 300;
    }
    if (msg.fileAttachments?.length) {
      for (const file of msg.fileAttachments) {
        total += estimateTokens(file.content || '');
      }
    }
  }
  return total;
}


export interface SubagentLoopEvent {
  type: 'chunk' | 'complete' | 'tool-start' | 'tool-end' | 'error';
  messageId: string;
  chunk?: string;
  chunkType?: 'content' | 'thinking';
  toolName?: string;
  toolCallId?: string;
  toolResult?: ToolResult;
  error?: string;
}

export interface RunAgentLoopOptions {
  systemPrompt: string;
  initialUserMessage: string;
  /** Fork 模式：从父会话消息快照启动，并追加 initialUserMessage */
  initialMessages?: ChatMessage[];
  /** 覆盖默认 skills 索引加载 */
  skillsContext?: string;
  tools: ToolDefinition[];          // 允许的工具子集
  model: string;                    // provider/model
  provider: AIProvider;             // provider

  context: ToolContext;             // baseDir / agentId / conversationId 等
  maxRounds: number;                // 最大工具调用轮次
  signal?: AbortSignal;             // 取消用
  onEvent?: (e: SubagentLoopEvent) => void; // 进度回调
  taskId?: string;                  // 子代理的任务 ID
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<{ finalText: string; steps: number; truncated?: boolean; promptTokens: number; completionTokens: number }> {
  const {
    systemPrompt,
    initialUserMessage,
    initialMessages,
    skillsContext: skillsContextOverride,
    tools,
    model,
    provider,
    context,
    maxRounds,
    signal,
    onEvent,
    taskId,
  } = options;

  let rounds = 0;
  let steps = 0;
  let accumulatedPromptTokens = 0;
  let accumulatedCompletionTokens = 0;

  const taskUserMessage: ChatMessage = {
    id: `sub-msg-user-${Date.now()}`,
    role: 'user',
    text: initialUserMessage,
    createdAt: Date.now(),
  };

  const messages: ChatMessage[] = initialMessages?.length
    ? [...initialMessages, taskUserMessage]
    : [taskUserMessage];

  let lastAssistantText = '';
  let messageCountAtRoundStart = messages.length;
  let pseudoToolCorrections = 0;
  const knownToolNames = tools.map((tool) => tool.name);
  const executedToolFingerprints = new Set<string>();
  const appDataPath = await resolveAppDataPath();

  while (rounds < maxRounds) {
    if (signal?.aborted) {
      throw new Error('Subagent loop aborted by user');
    }

    const assistantMessageId = `sub-assistant-${Date.now()}-${rounds}`;
    
    // Set up Tauri listeners first so we don't miss anything that starts immediately
    let accumulatedText = '';
    let accumulatedThinking = '';
    let completedToolCalls: ToolCall[] = [];


    // Use a deferred promise to wait for streaming events
    let resolveStream: (value: { text: string; toolCalls?: ToolCall[] }) => void;
    let rejectStream: (reason: Error) => void;
    const streamPromise = new Promise<{ text: string; toolCalls?: ToolCall[] }>((res, rej) => {
      resolveStream = res;
      rejectStream = rej;
    });

    const unlistenChunk = await listen<{ message_id: string; chunk: string; chunk_type: string }>(
      'ai-stream-chunk',
      (event) => {
        if (event.payload.message_id !== assistantMessageId) return;
        const { chunk, chunk_type } = event.payload;
        if (chunk_type === 'content' || chunk_type === 'delta') {
          accumulatedText += chunk;
          onEvent?.({ type: 'chunk', messageId: assistantMessageId, chunk, chunkType: 'content' });
        } else if (chunk_type === 'thinking') {
          accumulatedThinking += chunk;
          onEvent?.({ type: 'chunk', messageId: assistantMessageId, chunk, chunkType: 'thinking' });
        }
      }
    );

    const unlistenComplete = await listen<{
      message_id: string;
      tool_calls?: ToolCall[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      provider?: string;
      model?: string;
    }>(
      'ai-stream-complete',
      (event) => {
        if (event.payload.message_id !== assistantMessageId) return;
        completedToolCalls = event.payload.tool_calls || [];
        resolveStream({ text: accumulatedText, toolCalls: completedToolCalls });

        // 用量/成本追踪：子代理产生的 token 也计入（按子代理任务聚合）
        const usage = event.payload.usage;
        if (usage) {
          useUsageStore.getState().addUsage({
            sessionKey: taskId ? `subagent:${taskId}` : assistantMessageId,
            provider: event.payload.provider ?? provider,
            model: event.payload.model ?? model,
            input: usage.input_tokens,
            output: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens,
            cacheWrite: usage.cache_creation_input_tokens,
          });
        }
      }
    );

    const unlistenError = await listen<{ message_id: string; error: string }>(
      'ai-stream-error',
      (event) => {
        if (event.payload.message_id && event.payload.message_id !== assistantMessageId) return;
        rejectStream(new Error(event.payload.error || 'Unknown AI stream error'));
      }
    );

    // Track auto-routing provider switch for subagents (only log level for now)
    const unlistenProviderSwitched = await listen<{
      message_id: string;
      from_provider: string;
      from_model: string;
      to_provider: string;
      to_model: string;
    }>('ai-provider-switched', (event) => {
      if (event.payload.message_id !== assistantMessageId) return;
      console.warn(
        `[runAgentLoop] Auto-routing: ${event.payload.from_provider}/${event.payload.from_model} -> ${event.payload.to_provider}/${event.payload.to_model}`
      );
    });

    try {
      // 1. Prepare request messages using utils helpers
      const requestMessages: ProviderRequestMessage[] = toProviderRequestMessages(messages);
      const skillsContext =
        skillsContextOverride !== undefined
          ? skillsContextOverride
          : await loadSkillsContext(context.baseDir || '');
      const providerTools = formatToolsForProvider(provider, tools);
      
      const { messages: providerMessages } = buildContextForRequest({
        systemPrompt,
        projectPath: context.baseDir || '',
        shouldInjectProjectPath: rounds === 0, // Only inject project path first time
        skillsContext,
        requestMessages,
        provider,
        model,
        tools: providerTools,
        includeCoreSystemPrompt: false,
      });

      // 2. Trigger Rust chat streaming (with post-tool-call delay)
      const tcDelay = useSettingsStore.getState().toolCallDelay;
      if (tcDelay > 0) {
        await new Promise((r) => setTimeout(r, tcDelay));
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: assistantMessageId,
        model,
        messages: providerMessages,
        tools: providerTools,
        ...(providerTools ? { tool_choice: 'auto' } : {}),
        profileId: context.profileId,
        enableAutoRouting: false,
        toolChainConfig: {
          enableBackendOrchestration: false,
          maxRounds: 10,
          projectPath: context.baseDir || undefined,
          appDataPath,
          toolCallDelayMs: useSettingsStore.getState().toolCallDelay,
        },
      });

      // 3. Wait for the stream to complete or error out
      const streamResult = await streamPromise;
      const { toolCalls: resolvedToolCalls, cleanedText } = resolveSubagentStreamToolCalls(
        streamResult.text,
        streamResult.toolCalls,
        knownToolNames
      );
      lastAssistantText = cleanedText;

      // Add assistant message to messages
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        text: cleanedText,
        thinking: accumulatedThinking,
        tool_calls: resolvedToolCalls.length > 0 ? resolvedToolCalls : undefined,
        createdAt: Date.now(),
      };
      messages.push(assistantMessage);

      // Clean up event listeners for this turn
      unlistenChunk();
      unlistenComplete();
      unlistenError();
      unlistenProviderSwitched();

      onEvent?.({ type: 'complete', messageId: assistantMessageId });

      // Estimate completion tokens for this round
      accumulatedCompletionTokens += estimateTokens(cleanedText || '');
      if (accumulatedThinking) {
        accumulatedCompletionTokens += estimateTokens(accumulatedThinking);
      }

      // 4. Handle tool calls
      if (resolvedToolCalls.length > 0) {
        const toolMessages: ChatMessage[] = [];
        const executionId = `agent-${assistantMessageId}-r${steps}`;
        await beginSandboxExecution({
          executionId,
          sessionId: context.conversationId,
          label: 'agent-loop',
          projectPath: context.baseDir,
        });
        let executedNewToolThisRound = false;

        try {
        for (const toolCall of resolvedToolCalls) {
          if (signal?.aborted) {
            throw new Error('Subagent loop aborted by user');
          }

          const resolvedToolName = toolCall.function.name;
          const parsedArgs = parseToolCallArgs(toolCall.function.arguments);
          const fingerprint = buildToolCallFingerprint(resolvedToolName, parsedArgs);

          if (executedToolFingerprints.has(fingerprint)) {
            steps++;
            onEvent?.({
              type: 'tool-start',
              messageId: assistantMessageId,
              toolName: resolvedToolName,
              toolCallId: toolCall.id,
            });
            const duplicateResult: ToolResult = {
              tool_call_id: toolCall.id,
              output: DUPLICATE_TOOL_SKIP_MESSAGE,
            };
            onEvent?.({
              type: 'tool-end',
              messageId: assistantMessageId,
              toolName: resolvedToolName,
              toolCallId: toolCall.id,
              toolResult: duplicateResult,
            });
            toolMessages.push({
              id: `sub-tool-${toolCall.id}`,
              role: 'tool',
              text: DUPLICATE_TOOL_SKIP_MESSAGE,
              tool_call_id: toolCall.id,
              tool_name: resolvedToolName,
              createdAt: Date.now(),
            });
            messages.push(toolMessages[toolMessages.length - 1]);
            continue;
          }

          executedToolFingerprints.add(fingerprint);
          executedNewToolThisRound = true;
          
          steps++;
          onEvent?.({ type: 'tool-start', messageId: assistantMessageId, toolName: resolvedToolName, toolCallId: toolCall.id });
          // Execute the tool call using frontend executor with resource locking
          
          let result: ToolResult;
          const accessMode =
            context.subagentPermissionMode ?? useSettingsStore.getState().agentAccessMode;

          if (shouldBlockTool(accessMode, resolvedToolName)) {
            result = {
              tool_call_id: toolCall.id,
              output: '',
              error: '该工具已被访问档位策略拒绝 / This tool call has been denied by the access mode policy.',
            };
          } else {
            const needsApproval =
              shouldRequestApproval(accessMode, resolvedToolName) ||
              requiresConfirmation(resolvedToolName, parsedArgs, accessMode);

            if (needsApproval && !(context.onRequestToolApproval && taskId)) {
              // Needs approval but no approval mechanism available — deny for safety
              result = {
                tool_call_id: toolCall.id,
                output: '',
                error: '该工具需要审批但无法发起审批请求，已拒绝 / This tool requires approval but no approval handler is available, denied.',
              };
            } else if (needsApproval && context.onRequestToolApproval && taskId) {
            let approved = false;
            let abortHandler: (() => void) | undefined;
            
            // Generate detail preview
            let detailPreview = '';
            if (resolvedToolName === 'term' || resolvedToolName === 'terminal' || resolvedToolName === 'run_command') {
              const commandArg = parsedArgs.command ?? parsedArgs.script;
              detailPreview = typeof commandArg === 'string' ? commandArg : commandArg != null ? String(commandArg) : '';
            } else {
              const path = parsedArgs.path || parsedArgs.file_path || parsedArgs.file || parsedArgs.target || parsedArgs.dest || '';
              if (path) {
                detailPreview = String(path);
              } else {
                detailPreview = typeof toolCall.function.arguments === 'string'
                  ? toolCall.function.arguments
                  : JSON.stringify(toolCall.function.arguments || {});
              }
            }
            if (detailPreview.length > 200) {
              detailPreview = detailPreview.substring(0, 200) + '...';
            }

            try {
              const abortPromise = new Promise<'reject'>((_, reject) => {
                abortHandler = () => reject(new Error('Subagent loop aborted by user'));
                signal?.addEventListener('abort', abortHandler);
              });

              const approvalResult = await Promise.race([
                context.onRequestToolApproval({
                  taskId,
                  toolName: resolvedToolName,
                  detailPreview,
                }),
                abortPromise,
              ]);

              if (approvalResult === 'approve') {
                approved = true;
              }
            } catch (err) {
              if (abortHandler) {
                signal?.removeEventListener('abort', abortHandler);
              }
              throw err;
            } finally {
              if (abortHandler) {
                signal?.removeEventListener('abort', abortHandler);
              }
            }

            if (approved) {
              result = await subagentResourceLock.runExclusive(
                resolvedToolName,
                parsedArgs,
                () => executeToolCall(toolCall, { ...context, spawnParentTaskId: taskId })
              );
            } else {
              result = {
                tool_call_id: toolCall.id,
                output: '',
                error: detailPreview
                  ? `❌ 用户已拒绝工具调用「${resolvedToolName}」（${detailPreview}）。操作未执行，目标未被修改。请勿汇报操作成功。 / User denied tool "${resolvedToolName}" (${detailPreview}). NOT executed. Do NOT report success.`
                  : `❌ 用户已拒绝工具调用「${resolvedToolName}」。操作未执行，未产生任何变更。请勿汇报操作成功。 / User denied tool "${resolvedToolName}". NOT executed. Do NOT report success.`,
              };
            }
            } else {
              result = await subagentResourceLock.runExclusive(
                resolvedToolName,
                parsedArgs,
                () => executeToolCall(toolCall, { ...context, spawnParentTaskId: taskId })
              );
            }
          }
          
          onEvent?.({ type: 'tool-end', messageId: assistantMessageId, toolName: resolvedToolName, toolCallId: toolCall.id, toolResult: result });

          const toolMessage: ChatMessage = {
            id: `sub-tool-${toolCall.id}`,
            role: 'tool',
            text: result.error || result.output,
            tool_call_id: toolCall.id,
            tool_name: resolvedToolName,
            createdAt: Date.now(),
            isError: !!result.error,
          };
          toolMessages.push(toolMessage);
          messages.push(toolMessage);
        }
        } finally {
          await endSandboxExecution(executionId);
        }

        const { messages: agedMessages } = agePersistedChatToolMessages(messages);
        messages.splice(0, messages.length, ...agedMessages);

        if (!executedNewToolThisRound) {
          accumulatedPromptTokens += estimateChatMessagesTokens(
            messages.slice(messageCountAtRoundStart),
          );
          break;
        }

        rounds++;
      } else if (
        looksLikePseudoToolCall(cleanedText) &&
        pseudoToolCorrections < MAX_PSEUDO_TOOL_CORRECTIONS
      ) {
        pseudoToolCorrections += 1;
        messages.pop();
        messages.push({
          id: `sub-msg-correct-${Date.now()}-${pseudoToolCorrections}`,
          role: 'user',
          text: PSEUDO_TOOL_CORRECTION_MESSAGE,
          createdAt: Date.now(),
        });
        accumulatedPromptTokens += estimateChatMessagesTokens(
          messages.slice(messageCountAtRoundStart),
        );
        messageCountAtRoundStart = messages.length;
      } else {
        // No tool calls — count this round's new messages once, then finish.
        accumulatedPromptTokens += estimateChatMessagesTokens(
          messages.slice(messageCountAtRoundStart),
        );
        break;
      }

      accumulatedPromptTokens += estimateChatMessagesTokens(
        messages.slice(messageCountAtRoundStart),
      );
      messageCountAtRoundStart = messages.length;
    } catch (err) {
      // Ensure listeners are cleaned up even on error
      unlistenChunk();
      unlistenComplete();
      unlistenError();
      unlistenProviderSwitched();
      throw err;
    }
  }

  const truncated = rounds >= maxRounds;
  return { finalText: lastAssistantText, steps, truncated, promptTokens: accumulatedPromptTokens, completionTokens: accumulatedCompletionTokens };
}
