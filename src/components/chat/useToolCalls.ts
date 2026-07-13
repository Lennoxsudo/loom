import { useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  executeToolCall,
  normalizeToolArgs,
  parseToolArguments,
  resolvePathWithBaseDir,
  resolveUnderlyingToolName,
  sanitizeMessagesForIpc,
  ToolResult,
  toAnthropicTools,
  toGeminiTools,
  toOpenAITools,
} from '../../features/agent-engine';
import { useSubagentStore } from '../../stores/useSubagentStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { bootstrapSubagentFromToolArgs, isSubagentsEnabled } from '../../utils/subagents/bootstrap';
import { isRunCommandToolName } from '../../utils/parseCommandExecOutput';
import { useCommandExecProgress } from '../../hooks/useCommandExecProgress';
import type { ToolDefinition } from '../../types/ai';
import { estimateTokens } from '../../utils/contextBudget';
import { agePersistedChatToolMessages } from '../../utils/toolResultAging';
import { ToolGuard, requiresConfirmation } from '../../utils/toolGuard';
import {
  CREATE_DELETE_TOOLS,
  EXECUTE_TOOLS,
  GIT_TOOLS,
  isToolBlockedInPlanMode,
  WRITE_TOOLS,
} from '../../utils/agentTools';
import type { AgentAccessMode } from '../../types/settings';
import { shouldBlockTool } from '../../utils/agentAccessMode';
import { beginSandboxExecution, endSandboxExecution } from '../../utils/agentSandbox';
import { buildToolApprovalRejectionText } from '../agent/approvalUtils';
import { normalizePathForCompare } from '../../utils/pathUtils';
import { useCheckpointStore } from '../../stores/useCheckpointStore';
import {
  buildCheckpointLabel,
  collectPathsFromToolArgs,
  isCheckpointMutatingTool,
  type CheckpointFileSnapshot,
} from '../../utils/checkpointTimeline';
import { buildChatContextUsage } from './contextUsage';
import { buildConversationPayload } from './conversationPersist';
import { buildChatCheckpointSessionKey } from './chatUserMessageEdit';
import {
  reconcileChatRequestRuntime,
  syncChatRuntimeIfChanged,
  type ChatRuntimeSnapshot,
} from './chatRoutingRuntime';
import type {
  ChatApprovalActionType,
  ChatApprovalRequest,
  ChatApprovalSummary,
  ToolCall,
  Message,
  PendingFileChange,
} from './types';
import { useNotification } from '../../contexts/NotificationContext';
import { useTranslation } from '../../i18n';
import type { AIProvider } from '../../utils/visionCapabilities';
import type { QuestionInput, UserAnswer } from '../../features/agent-engine/toolArgs';
import { logDebug } from '../../utils/errorHandling';

const CHAT_APPROVAL_TOOL_NAME = 'chat_approval_request';

interface PreparedToolCall {
  toolCall: ToolCall;
  parsedArgs: Record<string, unknown>;
  normalizedArgs: Record<string, unknown>;
  underlyingToolName: string;
  isWriteTool: boolean;
  changedFilePath: string;
  resolvedWriteTargetPath: string;
  targetIsDirectory?: boolean;
  existedBefore?: boolean;
  beforeContent: string | null;
  approvalSummary: ChatApprovalSummary | null;
}

interface UseToolRoundOptions {
  sourceAssistantMessageId?: string;
  bypassApproval?: boolean;
  removedMessageIds?: string[];
}

export interface UseToolCallsOptions {
  chatRuntimeRef: React.MutableRefObject<ChatRuntimeSnapshot>;
  toolsEnabled: boolean;
  allConfiguredTools: ToolDefinition[];
  chatModeRef: React.MutableRefObject<'plan' | 'always-allow'>;
  projectPathRef: React.MutableRefObject<string>;
  currentConversationRef: React.MutableRefObject<import('./types').Conversation | null>;
  messagesRef: React.MutableRefObject<Message[]>;
  currentAssistantMessageId: string | null;
  setCurrentAssistantMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isExecutingToolsRef: React.MutableRefObject<boolean>;
  executedToolCallIdsRef: React.MutableRefObject<Set<string>>;
  toolAbortControllerRef: React.MutableRefObject<AbortController | null>;
  toolGuardRef: React.MutableRefObject<ToolGuard | null>;
  toolGuardBlockedRef: React.MutableRefObject<boolean>;
  ownedStreamMessageIdsRef: React.MutableRefObject<Set<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  onFilesChangedRef: React.MutableRefObject<((paths: string[]) => void) | undefined>;
  onPendingFileChangesDetected?: (changes: PendingFileChange[]) => void;
  getAppDataPath: () => Promise<string | null>;
  agentAccessMode: AgentAccessMode;
  onAskUserQuestion?: (
    conversationId: string,
    questions: QuestionInput[]
  ) => Promise<UserAnswer[]>;
  t: {
    agent: { planModeBlocked: string };
    errors: { permissionDeniedAction: string };
    settingsAgent: {
      chatToolApproval: {
        pendingTitle: string;
        pendingDescription: string;
        approvedState: string;
        deniedState: string;
        deniedResult: string;
        deniedResultWithTarget: string;
        commandType: string;
        fileType: string;
        createFileType?: string;
        createFolderType?: string;
        deleteFileType?: string;
        deleteFolderType?: string;
        moveFileType?: string;
        gitType: string;
        mcpType: string;
      };
    };
  };
}

function getStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function stripMcpPrefix(toolName: string): string {
  return toolName.replace(/^mcp_[^_]+__/, '');
}

function needsChatApproval(
  accessMode: AgentAccessMode,
  toolCall: ToolCall,
  parsedArgs: Record<string, unknown>,
  summary: ChatApprovalSummary | null
): boolean {
  if (!summary) {
    return false;
  }
  if (accessMode === 'read_only') {
    return true;
  }
  if (accessMode === 'auto') {
    // auto 模式：仅删除文件、危险命令模式、显式标记需审批的工具才弹卡片
    // 普通写入/编辑、普通命令执行、Git 操作、MCP 工具直接放行
    if (summary.type === 'command') {
      // 命令类：只有匹配危险模式（rm -rf, sudo, git push 等）才需审批
      return requiresConfirmation(toolCall.function.name, parsedArgs, accessMode);
    }
    if (summary.type === 'file') {
      // 文件类：只有删除操作才需审批
      const action = typeof parsedArgs.action === 'string' ? parsedArgs.action.toLowerCase() : '';
      const toolName = toolCall.function.name.toLowerCase();
      return toolName.includes('delete') || action === 'delete';
    }
    // git / mcp 直接放行
    return false;
  }
  return requiresConfirmation(toolCall.function.name, parsedArgs, accessMode);
}

function getApprovalType(
  toolName: string,
  underlyingToolName: string,
  args: Record<string, unknown> = {}
): ChatApprovalActionType | null {
  if (toolName.startsWith('mcp_')) {
    return 'mcp';
  }
  if (EXECUTE_TOOLS.has(toolName) || EXECUTE_TOOLS.has(underlyingToolName)) {
    return 'command';
  }
  const graphAction =
    typeof args.action === 'string' ? args.action.toLowerCase() : '';
  if (
    (toolName === 'graph_index' || underlyingToolName === 'graph_index') &&
    (graphAction === 'index' || graphAction === '')
  ) {
    return 'command';
  }
  if (
    WRITE_TOOLS.has(toolName) ||
    WRITE_TOOLS.has(underlyingToolName) ||
    CREATE_DELETE_TOOLS.has(toolName) ||
    CREATE_DELETE_TOOLS.has(underlyingToolName)
  ) {
    return 'file';
  }
  if (GIT_TOOLS.has(toolName) || GIT_TOOLS.has(underlyingToolName)) {
    return 'git';
  }
  return null;
}

function buildApprovalSummary(
  toolCall: ToolCall,
  normalizedArgs: Record<string, unknown>,
  underlyingToolName: string,
  targetIsDirectory: boolean | undefined,
  existedBefore: boolean | undefined,
  t: UseToolCallsOptions['t']
): ChatApprovalSummary | null {
  const type = getApprovalType(toolCall.function.name, underlyingToolName, normalizedArgs);
  if (!type) return null;

  const normalizedAction =
    typeof normalizedArgs.action === 'string' ? normalizedArgs.action.toLowerCase() : '';

  const detail =
    type === 'command'
      ? underlyingToolName === 'graph_index'
        ? getStringArg(normalizedArgs, ['action', 'repo_path']) ?? 'index'
        : getStringArg(normalizedArgs, ['command'])
      : type === 'file'
        ? getStringArg(normalizedArgs, [
            'path',
            'file_path',
            'file',
            'source',
            'destination',
            'folder_path',
          ])
        : type === 'git'
          ? getStringArg(normalizedArgs, ['action', 'repo_path', 'file_path'])
          : stripMcpPrefix(toolCall.function.name);

  const deleteLooksLikeFolder =
    normalizedAction === 'delete' &&
    (targetIsDirectory === true ||
      typeof normalizedArgs.folder_path === 'string' ||
      (typeof detail === 'string' && /[\\/]$/.test(detail)));

  const label =
    type === 'command'
      ? t.settingsAgent.chatToolApproval.commandType
      : type === 'file'
        ? underlyingToolName === 'delete_file' || normalizedAction === 'delete'
          ? deleteLooksLikeFolder
            ? (t.settingsAgent.chatToolApproval.deleteFolderType ?? '删除文件夹')
            : (t.settingsAgent.chatToolApproval.deleteFileType ?? '删除文件')
          : underlyingToolName === 'move_file' || normalizedAction === 'move'
            ? (t.settingsAgent.chatToolApproval.moveFileType ?? '移动文件')
            : underlyingToolName === 'create_folder' || normalizedAction === 'create_folder' || normalizedAction === 'mkdir'
              ? (t.settingsAgent.chatToolApproval.createFolderType ?? '创建文件夹')
              : (underlyingToolName === 'write_file' ||
                  underlyingToolName === 'write' ||
                  normalizedAction === 'create') &&
                existedBefore !== true
                ? (t.settingsAgent.chatToolApproval.createFileType ?? '创建文件')
                : t.settingsAgent.chatToolApproval.fileType
        : type === 'git'
          ? t.settingsAgent.chatToolApproval.gitType
          : t.settingsAgent.chatToolApproval.mcpType;

  return {
    type,
    toolName: toolCall.function.name,
    label,
    detail: detail || underlyingToolName,
  };
}

function createToolMessage(params: {
  id: string;
  content: string;
  toolCallId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  isError?: boolean;
  isStreaming?: boolean;
  approvalStatus?: Message['approvalStatus'];
}): Message {
  return {
    id: params.id,
    role: 'tool',
    content: params.content,
    tool_call_id: params.toolCallId,
    tool_name: params.toolName,
    tool_args: params.toolArgs,
    timestamp: Date.now(),
    tokens: estimateTokens(params.content),
    isError: params.isError,
    isStreaming: params.isStreaming,
    approvalStatus: params.approvalStatus,
  };
}

function mergeToolMessages(prev: Message[], incoming: Message[]): Message[] {
  const next = [...prev];
  for (const message of incoming) {
    const index = next.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      next[index] = message;
    } else {
      next.push(message);
    }
  }
  return next;
}

function buildToolMessageId(toolCallId: string) {
  return `tool-${toolCallId}`;
}

export function useToolCalls({
  chatRuntimeRef,
  toolsEnabled,
  allConfiguredTools,
  chatModeRef,
  projectPathRef,
  currentConversationRef,
  messagesRef,
  currentAssistantMessageId,
  setCurrentAssistantMessageId,
  setIsLoading,
  isExecutingToolsRef,
  executedToolCallIdsRef,
  toolAbortControllerRef,
  toolGuardRef,
  toolGuardBlockedRef,
  ownedStreamMessageIdsRef,
  setMessages,
  setError,
  onFilesChangedRef,
  onPendingFileChangesDetected,
  getAppDataPath,
  agentAccessMode,
  onAskUserQuestion,
  t,
}: UseToolCallsOptions) {
  const { showInfo } = useNotification();
  const uiT = useTranslation();
  const handleToolCallsRef = useRef<((toolCalls: ToolCall[]) => Promise<void>) | null>(null);
  const pendingApprovalRef = useRef<ChatApprovalRequest | null>(null);
  const activeCommandStreamsRef = useRef(new Map<string, string>());

  useCommandExecProgress((event) => {
    if (event.done) {
      activeCommandStreamsRef.current.delete(event.stream_id);
      return;
    }
    // 只处理 stdout 流，避免 stdout/stderr 同时输出相同内容导致文本重复
    if (event.started || !event.chunk || event.stream !== 'stdout') return;

    const toolMessageId = activeCommandStreamsRef.current.get(event.stream_id);
    if (!toolMessageId) return;

    setMessages((prev) =>
      mergeToolMessages(prev, [
        {
          id: toolMessageId,
          role: 'tool',
          content: `${prev.find((m) => m.id === toolMessageId)?.content || ''}${event.chunk}`,
          tool_call_id: event.stream_id,
          tool_name: 'run_command',
          timestamp: Date.now(),
          tokens: 0,
          isStreaming: true,
        },
      ])
    );
  });

  const getProviderToolsForChat = (
    provider: AIProvider,
    tools: typeof allConfiguredTools,
    _chatMode: 'plan' | 'always-allow',
    enabled: boolean
  ) => {
    if (!enabled) return undefined;
    const filteredTools = tools;
    if (provider === 'anthropic') {
      return toAnthropicTools(filteredTools);
    }
    if (provider === 'gemini') {
      return toGeminiTools(filteredTools);
    }
    return toOpenAITools(filteredTools);
  };

  const removeApprovalMessage = (requestId: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== requestId));
  };

  const continueWithToolResults = async (
    toolMessages: Message[],
    pendingToolCalls?: ToolCall[],
    sourceAssistantMessageId?: string,
    removedMessageIds: string[] = []
  ) => {
    const newAssistantMessageId = `${Date.now()}-continue`;
    ownedStreamMessageIdsRef.current.add(newAssistantMessageId);
    const newAssistantMessage: Message = {
      id: newAssistantMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true,
      startTime: Date.now(),
    };

    setMessages((prev) => [...prev, newAssistantMessage]);
    setCurrentAssistantMessageId(newAssistantMessageId);
    setIsLoading(true);
    isExecutingToolsRef.current = false;

    try {
      let provider = chatRuntimeRef.current.provider;
      let model = chatRuntimeRef.current.model;
      let profileId = chatRuntimeRef.current.profileId;

      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          const reconciled = reconcileChatRequestRuntime(
            config,
            chatRuntimeRef.current.routingMode === 'auto' ? 'auto' : provider,
            model,
            chatRuntimeRef.current,
            { reuseActiveEntry: true }
          );
          if (reconciled) {
            provider = reconciled.provider;
            model = reconciled.model;
            profileId = reconciled.profileId;
            syncChatRuntimeIfChanged(chatRuntimeRef, reconciled, undefined, {
              skipUiSync: chatRuntimeRef.current.routingMode === 'auto',
            });
          }
        }
      } catch {
        // keep current runtime when config cannot be loaded
      }

      const removedIds = new Set(removedMessageIds);
      const baseMessages = [...messagesRef.current].filter(
        (msg) => msg.id !== newAssistantMessageId && !removedIds.has(msg.id)
      );

      if (pendingToolCalls && pendingToolCalls.length > 0 && sourceAssistantMessageId) {
        for (let i = baseMessages.length - 1; i >= 0; i -= 1) {
          const msg = baseMessages[i];
          if (!msg || msg.id !== sourceAssistantMessageId || msg.role !== 'assistant') continue;
          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            baseMessages[i] = { ...msg, tool_calls: pendingToolCalls };
          }
          break;
        }
      } else if (pendingToolCalls && pendingToolCalls.length > 0) {
        for (let i = baseMessages.length - 1; i >= 0; i -= 1) {
          if (baseMessages[i].role === 'assistant' && !baseMessages[i].tool_calls) {
            baseMessages[i] = { ...baseMessages[i], tool_calls: pendingToolCalls };
            break;
          }
        }
      }

      const stableBaseMessages = baseMessages.filter(
        (msg) =>
          !msg.isStreaming ||
          (sourceAssistantMessageId !== undefined && msg.id === sourceAssistantMessageId)
      );

      const allStableMessages = [...stableBaseMessages];
      const existingIds = new Set(allStableMessages.map((m) => m.id));
      for (const toolMsg of toolMessages) {
        if (!existingIds.has(toolMsg.id)) {
          allStableMessages.push(toolMsg);
        }
      }

      const continueTools = toolsEnabled
        ? getProviderToolsForChat(provider, allConfiguredTools, chatModeRef.current, toolsEnabled)
        : undefined;

      const {
        preparedMessages: trimmedMessages,
        compressed,
        messages: compactedMessages,
        compactState,
      } = await buildChatContextUsage({
        messages: allStableMessages,
        provider,
        model,
        profileId,
        tools: continueTools,
        projectPath: projectPathRef.current,
        chatMode: chatModeRef.current,
        chatRules: [],
        chatRulesInjected: true,
        compactState: currentConversationRef.current?.compactState,
      });

      if (compressed) {
        showInfo(uiT.chat.contextCompressionHint);
        setMessages((prev) => {
          const streaming = prev.filter((m) => m.isStreaming);
          return [...compactedMessages, ...streaming];
        });
        if (currentConversationRef.current) {
          const updatedConv = buildConversationPayload(
            currentConversationRef.current,
            compactedMessages,
            compactState,
          );
          currentConversationRef.current = updatedConv;
          await invoke('save_conversation', { conversation: updatedConv });
        }
      }

      // Post-tool-call delay: allow UI to display results before next stream
      const tcDelay = useSettingsStore.getState().toolCallDelay;
      if (tcDelay > 0) {
        await new Promise((r) => setTimeout(r, tcDelay));
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: newAssistantMessageId,
        model,
        profileId,
        enableAutoRouting: chatRuntimeRef.current.routingMode === 'auto',
        messages: sanitizeMessagesForIpc(trimmedMessages),
        tools: sanitizeMessagesForIpc(continueTools),
        toolChainConfig: {
          enableBackendOrchestration: true,
          maxRounds: 10,
          projectPath: projectPathRef.current,
          appDataPath: (await getAppDataPath()) ?? undefined,
          toolCallDelayMs: useSettingsStore.getState().toolCallDelay,
        },
      });
    } catch (error) {
      ownedStreamMessageIdsRef.current.delete(newAssistantMessageId);
      setError(`Continue conversation failed: ${error}`);
      setIsLoading(false);
    }
  };

  const prepareToolCalls = async (toolCallsToExecute: ToolCall[]) => {
    const prepared: PreparedToolCall[] = [];

    for (const toolCall of toolCallsToExecute) {
      let parsedArgs: unknown = toolCall.function.arguments;
      try {
        const rawArgsStr =
          typeof toolCall.function.arguments === 'string'
            ? toolCall.function.arguments
            : JSON.stringify(toolCall.function.arguments ?? {});
        parsedArgs = parseToolArguments(rawArgsStr);
      } catch {
        // Keep original args
      }

      const argsObj =
        typeof parsedArgs === 'object' && parsedArgs !== null
          ? (parsedArgs as Record<string, unknown>)
          : {};
      const normalizedArgs = normalizeToolArgs(argsObj, toolCall.function.name) as Record<
        string,
        unknown
      >;
      const underlyingToolName = resolveUnderlyingToolName(toolCall.function.name, normalizedArgs);
      const isWriteTool =
        WRITE_TOOLS.has(toolCall.function.name) || WRITE_TOOLS.has(underlyingToolName);
      const changedFilePath =
        typeof normalizedArgs.path === 'string'
          ? normalizedArgs.path
          : typeof normalizedArgs.file_path === 'string'
            ? normalizedArgs.file_path
            : typeof normalizedArgs.file === 'string'
              ? normalizedArgs.file
              : '';
      const baseDir = projectPathRef.current?.trim() || undefined;
      const resolvedWriteTargetPath =
        isWriteTool && changedFilePath
          ? baseDir
            ? resolvePathWithBaseDir(changedFilePath.trim(), baseDir)
            : changedFilePath.trim()
          : '';
      const resolvedInfoTargetPath =
        !resolvedWriteTargetPath && changedFilePath
          ? baseDir
            ? resolvePathWithBaseDir(changedFilePath.trim(), baseDir)
            : changedFilePath.trim()
          : resolvedWriteTargetPath;

      let existedBefore: boolean | undefined;
      let beforeContent: string | null = null;
      let targetIsDirectory: boolean | undefined;

      if (resolvedInfoTargetPath) {
        try {
          const fileInfo = await invoke<{
            exists?: boolean;
            is_dir?: boolean;
            is_directory?: boolean;
            isDirectory?: boolean;
            file_type?: string;
          }>('get_file_info', {
            path: resolvedInfoTargetPath,
          });
          existedBefore = fileInfo?.exists === true;
          targetIsDirectory =
            fileInfo?.is_dir === true ||
            fileInfo?.is_directory === true ||
            fileInfo?.isDirectory === true ||
            fileInfo?.file_type === 'directory';
        } catch {
          // Best effort only
        }
      }

      if (isWriteTool && resolvedWriteTargetPath) {
        try {
          beforeContent = await invoke<string>('read_file_content', {
            filePath: resolvedWriteTargetPath,
          });
          existedBefore = true;
        } catch {
          // File may not exist yet
        }
      }

      prepared.push({
        toolCall,
        parsedArgs: normalizedArgs,
        normalizedArgs,
        underlyingToolName,
        isWriteTool,
        changedFilePath,
        resolvedWriteTargetPath,
        targetIsDirectory,
        existedBefore,
        beforeContent,
        approvalSummary: buildApprovalSummary(
          toolCall,
          normalizedArgs,
          underlyingToolName,
          targetIsDirectory,
          existedBefore,
          t
        ),
      });
    }

    return prepared;
  };

  const finalizeToolRound = async (
    toolMessages: Message[],
    originalToolCalls: ToolCall[],
    sourceAssistantMessageId?: string,
    removedMessageIds: string[] = []
  ) => {
    setMessages((prev) => {
      const merged = mergeToolMessages(prev, toolMessages);
      return agePersistedChatToolMessages(merged).messages;
    });
    await continueWithToolResults(
      toolMessages,
      originalToolCalls,
      sourceAssistantMessageId,
      removedMessageIds
    );
  };

  const runPreparedToolCalls = async (
    preparedCalls: PreparedToolCall[],
    duplicateToolCalls: ToolCall[],
    originalToolCalls: ToolCall[],
    sourceAssistantMessageId?: string,
    removedMessageIds: string[] = [],
    extraMessages: Message[] = []
  ) => {
    const abortController = new AbortController();
    toolAbortControllerRef.current = abortController;

    try {
      const toolResults: ToolResult[] = [];
      const pendingChanges: PendingFileChange[] = [];

      for (const prepared of preparedCalls) {
        if (abortController.signal.aborted) {
          throw new Error('Tool execution aborted');
        }

        const {
          toolCall,
          parsedArgs,
          normalizedArgs,
          underlyingToolName,
          isWriteTool,
          changedFilePath,
          resolvedWriteTargetPath,
          existedBefore,
          beforeContent,
        } = prepared;

        if (chatModeRef.current === 'plan' && isToolBlockedInPlanMode(toolCall.function.name)) {
          const content = `${t.agent.planModeBlocked}: ${toolCall.function.name}`;
          toolResults.push({
            tool_call_id: toolCall.id,
            output: content,
            error: content,
          });
          continue;
        }

        // Action-granularity checkpoint (pre-tool) for time-travel / bubble edit-resend
        const shouldCheckpoint =
          isCheckpointMutatingTool(toolCall.function.name) ||
          isCheckpointMutatingTool(underlyingToolName);
        const baseDir = projectPathRef.current?.trim() || '';
        const conversationId = currentConversationRef.current?.id;
        if (shouldCheckpoint && baseDir && conversationId) {
          const argPaths = collectPathsFromToolArgs(
            toolCall.function.name,
            parsedArgs as Record<string, unknown>
          );
          const resolvedPaths = argPaths.map((p) =>
            resolvePathWithBaseDir(String(p).trim(), baseDir)
          );
          const snapshots: CheckpointFileSnapshot[] = [];
          for (const resolvedPath of resolvedPaths) {
            if (!resolvedPath) continue;
            const matchesWriteTarget =
              resolvedWriteTargetPath &&
              normalizePathForCompare(resolvedPath).toLowerCase() ===
                normalizePathForCompare(resolvedWriteTargetPath).toLowerCase();
            if (matchesWriteTarget) {
              snapshots.push({
                path: resolvedWriteTargetPath,
                existed: existedBefore === true,
                content: beforeContent,
              });
              continue;
            }
            let existed = false;
            let content: string | null = null;
            try {
              const fileInfo = await invoke<{ exists?: boolean }>('get_file_info', {
                path: resolvedPath,
              });
              existed = fileInfo?.exists === true;
            } catch {
              // ignore
            }
            try {
              content = await invoke<string>('read_file_content', { filePath: resolvedPath });
              existed = true;
            } catch {
              content = null;
            }
            snapshots.push({ path: resolvedPath, existed, content });
          }

          if (snapshots.length > 0) {
            let lastUserMessageId: string | undefined;
            const convMessages = messagesRef.current;
            for (let i = convMessages.length - 1; i >= 0; i--) {
              if (convMessages[i]?.role === 'user') {
                lastUserMessageId = convMessages[i].id;
                break;
              }
            }
            void useCheckpointStore.getState().addCheckpoint({
              sessionKey: buildChatCheckpointSessionKey(baseDir, conversationId),
              projectPath: baseDir,
              toolCallId: toolCall.id,
              userMessageId: lastUserMessageId,
              toolName: toolCall.function.name,
              label: buildCheckpointLabel(
                toolCall.function.name,
                snapshots.map((s) => s.path)
              ),
              files: snapshots,
            });
          }
        }

        const isGenerateImage = toolCall.function.name === 'generate_image';
        const isRunCommand = isRunCommandToolName(toolCall.function.name, parsedArgs);
        const isRunSubagent = toolCall.function.name === 'run_subagent';
        const isRunSubagents = toolCall.function.name === 'run_subagents';
        const isAgentTool = toolCall.function.name === 'Agent' || toolCall.function.name === 'Task';
        const isSubagentTool = isRunSubagent || isRunSubagents || isAgentTool;
        const subagentsEnabled = isSubagentsEnabled();
        const toolMessageId = buildToolMessageId(toolCall.id);
        const displayToolName = isRunCommand ? 'run_command' : underlyingToolName;
        if (isGenerateImage || isRunCommand || (subagentsEnabled && isSubagentTool)) {
          if (subagentsEnabled && isSubagentTool) {
            bootstrapSubagentFromToolArgs(toolCall.id, parsedArgs);
          }
          if (isRunCommand) {
            activeCommandStreamsRef.current.set(toolCall.id, toolMessageId);
          }
          setMessages((prev) =>
            mergeToolMessages(prev, [
              createToolMessage({
                id: toolMessageId,
                content: '',
                toolCallId: toolCall.id,
                toolName: displayToolName,
                toolArgs: parsedArgs,
                isStreaming: true,
              }),
            ])
          );
        }

        const guarded = await toolGuardRef.current!.runToolGuarded({
          toolCall,
          parsedArgs,
          execute: () =>
            executeToolCall(toolCall, {
              baseDir: projectPathRef.current || undefined,
              agentId: currentConversationRef.current?.id,
              conversationId: currentConversationRef.current?.id,
              parentProvider: chatRuntimeRef.current.provider,
              parentModel: chatRuntimeRef.current.model,
              parentToolNames: allConfiguredTools.map((tool) => tool.name),
              toolCallId: toolCall.id,
              onAskUserQuestion,
              onRequestToolApproval: async (req) => {
                return new Promise<'approve' | 'reject'>((resolve) => {
                  useSubagentStore.getState().setPendingApproval(req.taskId, {
                    toolName: req.toolName,
                    detailPreview: req.detailPreview,
                    resolve: (choice) => {
                      useSubagentStore.getState().clearPendingApproval(req.taskId);
                      resolve(choice);
                    },
                  });
                });
              },
            }),
        });

        if (guarded.blocked) {
          toolGuardBlockedRef.current = true;
          const blockedMessage = createToolMessage({
            id: `tool-guard-${toolCall.id}-${Date.now()}`,
            content: `${t.errors.permissionDeniedAction}: ${guarded.reason}`,
            toolCallId: toolCall.id,
            toolName: underlyingToolName,
            toolArgs: parsedArgs,
            isError: true,
          });
          await finalizeToolRound(
            [blockedMessage],
            originalToolCalls,
            sourceAssistantMessageId,
            removedMessageIds
          );
          return;
        }

        toolResults.push(guarded.result);
        activeCommandStreamsRef.current.delete(toolCall.id);

        if (isGenerateImage || isRunCommand || (subagentsEnabled && isSubagentTool)) {
          setMessages((prev) =>
            mergeToolMessages(prev, [
              createToolMessage({
                id: toolMessageId,
                content: guarded.result.error || guarded.result.output,
                toolCallId: toolCall.id,
                toolName: displayToolName,
                toolArgs: parsedArgs,
                isError: !!guarded.result.error,
                isStreaming: false,
              }),
            ])
          );
        }

        if (
          isWriteTool &&
          guarded.result.files_changed &&
          guarded.result.files_changed.length > 0 &&
          !guarded.result.error
        ) {
          for (const filePath of guarded.result.files_changed) {
            if (typeof filePath !== 'string' || !filePath.trim()) continue;
            try {
              const afterContent = await invoke<string>('read_file_content', { filePath });
              const normalizedTarget = normalizePathForCompare(filePath).toLowerCase();
              const normalizedOriginal = normalizePathForCompare(
                resolvedWriteTargetPath || changedFilePath
              ).toLowerCase();
              const existingChange = pendingChanges.find(
                (change) =>
                  normalizePathForCompare(change.filePath).toLowerCase() === normalizedTarget
              );
              const now = Date.now();

              pendingChanges.push({
                id: existingChange?.id ?? `pc-${now}-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
                filePath,
                existedBefore: existingChange?.existedBefore ?? existedBefore,
                beforeContent:
                  existingChange?.beforeContent !== undefined
                    ? existingChange.beforeContent
                    : normalizedTarget === normalizedOriginal
                      ? beforeContent
                      : null,
                afterContent,
                toolName: underlyingToolName,
                oldSnippet:
                  typeof normalizedArgs.old_string === 'string' ||
                  typeof normalizedArgs.old === 'string'
                    ? String(normalizedArgs.old_string ?? normalizedArgs.old)
                    : undefined,
                newSnippet:
                  typeof normalizedArgs.new_string === 'string' ||
                  typeof normalizedArgs.new === 'string'
                    ? String(normalizedArgs.new_string ?? normalizedArgs.new)
                    : undefined,
                createdAt: existingChange?.createdAt ?? now,
                updatedAt: now,
              });
            } catch {
              // Ignore inaccessible file
            }
          }
        }
      }

      const changedPaths = toolResults
        .flatMap((result) => result.files_changed ?? [])
        .filter((path): path is string => typeof path === 'string' && path.trim().length > 0);

      if (changedPaths.length > 0) {
        onFilesChangedRef.current?.(Array.from(new Set(changedPaths)));
      }

      if (pendingChanges.length > 0) {
        const deduped = new Map<string, PendingFileChange>();
        for (const change of pendingChanges) {
          deduped.set(normalizePathForCompare(change.filePath).toLowerCase(), change);
        }
        onPendingFileChangesDetected?.(Array.from(deduped.values()));
      }

      const toolMessages: Message[] = toolResults.map((result) => {
        const prepared = preparedCalls.find((item) => item.toolCall.id === result.tool_call_id);
        const toolName = prepared?.underlyingToolName || 'Tool';
        return createToolMessage({
          id: buildToolMessageId(result.tool_call_id),
          content: result.error || result.output,
          toolCallId: result.tool_call_id,
          toolName,
          toolArgs: prepared?.parsedArgs,
          isError: !!result.error,
          isStreaming: false,
        });
      });

      const duplicateMessages = duplicateToolCalls.map((toolCall) =>
        createToolMessage({
          id: `tool-${toolCall.id}-${Date.now()}`,
          content: `Skipped duplicate tool call: ${toolCall.function.name}`,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
        })
      );

      await finalizeToolRound(
        [...extraMessages, ...toolMessages, ...duplicateMessages],
        originalToolCalls,
        sourceAssistantMessageId,
        removedMessageIds
      );
    } catch (error) {
      if (!abortController.signal.aborted) {
        setError(`Tool execution failed: ${error}`);
      }
      isExecutingToolsRef.current = false;
      setIsLoading(false);
    } finally {
      if (toolAbortControllerRef.current === abortController) {
        toolAbortControllerRef.current = null;
      }
    }
  };

  const createApprovalRequest = (
    toolCalls: ToolCall[],
    summaries: ChatApprovalSummary[],
    sourceAssistantMessageId?: string
  ) => {
    const request: ChatApprovalRequest = {
      requestId: `approval-${Date.now()}`,
      status: 'pending',
      summaries,
      toolCalls,
      sourceAssistantMessageId,
    };
    pendingApprovalRef.current = request;

    const approvalMessage: Message = {
      id: request.requestId,
      role: 'tool',
      tool_name: CHAT_APPROVAL_TOOL_NAME,
      tool_call_id: request.requestId,
      content: t.settingsAgent.chatToolApproval.pendingTitle,
      tool_args: request as unknown as Record<string, unknown>,
      timestamp: Date.now(),
      tokens: estimateTokens(t.settingsAgent.chatToolApproval.pendingDescription),
    };

    setMessages((prev) => [...prev, approvalMessage]);
    setIsLoading(false);
    isExecutingToolsRef.current = false;
  };

  const createDeniedMessages = (toolCalls: ToolCall[]) =>
    toolCalls.map((toolCall) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = normalizeToolArgs(
          JSON.parse(toolCall.function.arguments || '{}'),
          toolCall.function.name
        ) as Record<string, unknown>;
      } catch {
        // Ignore parse errors
      }

      return createToolMessage({
        id: `tool-denied-${toolCall.id}-${Date.now()}`,
        content: buildToolApprovalRejectionText(
          resolveUnderlyingToolName(toolCall.function.name, parsedArgs),
          parsedArgs,
          {
            rejectedToolResult: t.settingsAgent.chatToolApproval.deniedResult,
            rejectedToolResultWithTarget: t.settingsAgent.chatToolApproval.deniedResultWithTarget,
          }
        ),
        toolCallId: toolCall.id,
        toolName: resolveUnderlyingToolName(toolCall.function.name, parsedArgs),
        toolArgs: parsedArgs,
        isError: true,
        approvalStatus: 'rejected',
      });
    });

  const executeToolRound = async (
    toolCalls: ToolCall[],
    options: UseToolRoundOptions = {}
  ) => {
    const sourceAssistantMessageId = options.sourceAssistantMessageId ?? currentAssistantMessageId ?? undefined;
    logDebug(`Chat tool round: ${JSON.stringify(toolCalls)}`, 'ChatPanel');
    isExecutingToolsRef.current = true;

    if (toolGuardBlockedRef.current) {
      const blockedMessage = createToolMessage({
        id: `tool-guarded-blocked-${Date.now()}`,
        content: t.errors.permissionDeniedAction,
        toolCallId: `tool-guarded-blocked-${Date.now()}`,
        toolName: 'tool_guard',
        isError: true,
      });
      await finalizeToolRound([blockedMessage], toolCalls, sourceAssistantMessageId);
      return;
    }

    if (!toolGuardRef.current) {
      toolGuardRef.current = new ToolGuard();
    }

    const toolCallsToExecute: ToolCall[] = [];
    const duplicateToolCalls: ToolCall[] = [];

    for (const toolCall of toolCalls) {
      if (executedToolCallIdsRef.current.has(toolCall.id)) {
        duplicateToolCalls.push(toolCall);
        continue;
      }
      executedToolCallIdsRef.current.add(toolCall.id);
      toolCallsToExecute.push(toolCall);
    }

    const conversationId = currentConversationRef.current?.id;
    const executionId = `chat-${conversationId ?? 'unknown'}-${Date.now()}`;
    try {
      await beginSandboxExecution({
        executionId,
        sessionId: conversationId,
        label: 'chat-tools',
        projectPath: projectPathRef.current?.trim() || undefined,
      });

      const preparedCalls = await prepareToolCalls(toolCallsToExecute);
      const blockedCalls = preparedCalls.filter((item) =>
        shouldBlockTool(agentAccessMode, item.toolCall.function.name)
      );
      const allowedCalls = preparedCalls.filter(
        (item) => !shouldBlockTool(agentAccessMode, item.toolCall.function.name)
      );
      const deniedMessages =
        blockedCalls.length > 0
          ? createDeniedMessages(blockedCalls.map((item) => item.toolCall))
          : [];

      if (allowedCalls.length === 0) {
        await finalizeToolRound(
          [
            ...deniedMessages,
            ...duplicateToolCalls.map((toolCall) =>
              createToolMessage({
                id: `tool-${toolCall.id}-${Date.now()}`,
                content: `Skipped duplicate tool call: ${toolCall.function.name}`,
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
              })
            ),
          ],
          toolCalls,
          sourceAssistantMessageId
        );
        return;
      }

      const callsNeedingApproval = allowedCalls.filter(
        (item) =>
          !options.bypassApproval &&
          needsChatApproval(
            agentAccessMode,
            item.toolCall,
            item.parsedArgs as Record<string, unknown>,
            item.approvalSummary
          )
      );

      if (callsNeedingApproval.length > 0) {
        for (const item of callsNeedingApproval) {
          executedToolCallIdsRef.current.delete(item.toolCall.id);
        }
        createApprovalRequest(
          callsNeedingApproval.map((item) => item.toolCall),
          callsNeedingApproval
            .map((item) => item.approvalSummary)
            .filter((item): item is ChatApprovalSummary => item !== null),
          sourceAssistantMessageId
        );
        return;
      }

      await runPreparedToolCalls(
        allowedCalls,
        duplicateToolCalls,
        toolCalls,
        sourceAssistantMessageId,
        options.removedMessageIds ?? [],
        deniedMessages
      );
    } catch (error) {
      setError(`Tool execution failed: ${error}`);
      isExecutingToolsRef.current = false;
      setIsLoading(false);
    } finally {
      await endSandboxExecution(executionId);
    }
  };

  const approvePendingToolCalls = async (requestId: string) => {
    const request = pendingApprovalRef.current;
    if (!request || request.requestId !== requestId) return;
    pendingApprovalRef.current = null;
    removeApprovalMessage(requestId);
    await executeToolRound(request.toolCalls, {
      sourceAssistantMessageId: request.sourceAssistantMessageId,
      bypassApproval: true,
      removedMessageIds: [requestId],
    });
  };

  const denyPendingToolCalls = async (requestId: string) => {
    const request = pendingApprovalRef.current;
    if (!request || request.requestId !== requestId) return;
    pendingApprovalRef.current = null;
    removeApprovalMessage(requestId);
    const deniedMessages = createDeniedMessages(request.toolCalls);
    await finalizeToolRound(
      deniedMessages,
      request.toolCalls,
      request.sourceAssistantMessageId,
      [requestId]
    );
  };

  const handleToolCalls = async (toolCalls: ToolCall[]) => {
    await executeToolRound(toolCalls);
  };

  handleToolCallsRef.current = handleToolCalls;

  return {
    handleToolCalls,
    handleToolCallsRef,
    continueWithToolResults,
    getProviderToolsForChat,
    approvePendingToolCalls,
    denyPendingToolCalls,
  };
}
