import { useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  type Agent,
  type AIProvider,
} from '../../../utils/agentPersistence';
import {
  executeToolCall,
  normalizeToolArgs,
  resolvePathWithBaseDir,
  resolveUnderlyingToolName,
  type ToolCall,
} from '../../../utils/aiTools';
import { attachSubagentRunsSnapshot } from '../../../utils/subagents/persistSubagentRuns';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import {
  isToolBlockedInPlanMode,
  getToolBlockedByCapability,
  WRITE_TOOLS,
} from '../../../utils/agentTools';
import type { AgentAccessMode } from '../../../types/settings';
import {
  shouldBlockTool,
  shouldRequestApproval,
} from '../../../utils/agentAccessMode';
import { requiresConfirmation } from '../../../utils/toolGuard';
import { beginSandboxExecution, endSandboxExecution } from '../../../utils/agentSandbox';
import type { QuestionInput, UserAnswer } from '../../../utils/aiTools/toolArgs';
import { buildPendingSessionKey, createAssistantMessageId } from '../utils';
import type { PendingFileChange } from '../utils';
import { normalizePathForCompare } from '../../../utils/pathUtils';
import { MAX_PREVIEW_HISTORY } from '../../../types/chat';
import { agePersistedChatToolMessages } from '../../../utils/toolResultAging';
import { useToolStore } from '../../../stores/useToolStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import type { ToolDefinition } from '../../../types/ai';
import {
  type ChatMessage,
  type AgentConversationState,
  type StreamMeta,
} from '../../../types/chat';
import {
  reconcileRuntimeForAgentRequest,
  resolveAgentRequestRuntime,
  syncReconciledRuntimeIfChanged,
  type AgentRuntimeSnapshot,
} from '../utils';
import { buildAgentRequestContext } from '../contextUsage';
import { useNotification } from '../../../contexts/NotificationContext';
import { useTranslation } from '../../../i18n';
import { logDebug } from '../../../utils/errorHandling';
import { bootstrapSubagentFromToolArgs, isSubagentsEnabled } from '../../../utils/subagents/bootstrap';
import { isRunCommandToolName } from '../../../utils/parseCommandExecOutput';
import { useCommandExecProgress } from '../../../hooks/useCommandExecProgress';
import {
  buildApprovalSummary,
  buildToolApprovalRejectionText,
  needsAgentApproval,
} from '../approvalUtils';
import type { ChatApprovalSummary } from '../../chat/types';

function buildAgentToolMessageId(toolCallId: string) {
  return `tool-${toolCallId}`;
}

function mergeAgentMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
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

function upsertAgentToolMessage(
  conversationId: string,
  message: ChatMessage,
  setConversationState: UseAgentToolCallsOptions['setConversationState']
) {
  setConversationState((prev) => {
    const conversations = prev.conversations.map((conv) => {
      if (conv.id !== conversationId) return conv;
      return {
        ...conv,
        updatedAt: Date.now(),
        messages: mergeAgentMessages(conv.messages, [message]),
      };
    });
    return { ...prev, conversations };
  });
}

export interface UseAgentToolCallsOptions {
  agentRef: React.MutableRefObject<Agent | null>;
  activeProjectKeyRef: React.MutableRefObject<string>;
  agentRuntimeRef: React.MutableRefObject<AgentRuntimeSnapshot>;
  agentModesRef: React.MutableRefObject<Record<string, 'plan' | 'always-allow'>>;
  projectPathRef: React.MutableRefObject<string>;
  conversationStateRef: React.MutableRefObject<AgentConversationState>;
  agentAccessMode: AgentAccessMode;
  handleToolCallsRef: React.MutableRefObject<
    | ((
        toolCalls: ToolCall[],
        agentId: string,
        conversationId: string,
        assistantMessageId: string
      ) => Promise<void>)
    | null
  >;
  setConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
  setError: (msg: string | null) => void;
  trackStream: (messageId: string, meta: StreamMeta) => void;
  clearTrackedStream: (messageId: string) => StreamMeta | null;
  isStopRequested: (sessionKey: string) => boolean;
  consumeStopRequest: (sessionKey: string) => boolean;
  getProviderTools: (provider: AIProvider, currentAgentId?: string) => unknown[];
  getAgentToolDefinitions: (currentAgentId?: string) => ToolDefinition[];
  getAppDataPath: () => Promise<string | null>;
  onFilesChangedRef: React.MutableRefObject<((paths: string[]) => void) | undefined>;
  onSetPendingChangesBySession: React.Dispatch<React.SetStateAction<Record<string, PendingFileChange[]>>>;
  onAskUserQuestion: (agentId: string, questions: QuestionInput[]) => Promise<UserAnswer[]>;
  onRuntimeReconciled?: (runtime: AgentRuntimeSnapshot) => void;
  onRequestApproval: (request: {
    messageId: string;
    summary: ChatApprovalSummary;
  }) => Promise<boolean>;
  t: {
    settingsAgent: {
      commandExecution: { blockedByPolicy: string; cancelledByUser: string; requestPrompt: string };
      chatToolApproval: {
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
    agent: {
      planModeBlocked: string;
      approvalDialog: {
        rejectedToolResult: string;
        rejectedToolResultWithTarget: string;
      };
    };
    errors: { permissionDeniedAction: string; continueConversationFailed: string };
  };
}

export function useAgentToolCalls(options: UseAgentToolCallsOptions) {
  const {
    agentRef,
    activeProjectKeyRef,
    agentRuntimeRef,
    agentModesRef,
    projectPathRef,
    conversationStateRef,
    agentAccessMode,
    handleToolCallsRef,
    setConversationState,
    setError,
    trackStream,
    clearTrackedStream,
    isStopRequested,
    consumeStopRequest,
    getProviderTools,
    getAgentToolDefinitions,
    getAppDataPath,
    onFilesChangedRef,
    onSetPendingChangesBySession,
    onAskUserQuestion,
    onRuntimeReconciled,
    onRequestApproval,
    t,
  } = options;

  const { showInfo } = useNotification();
  const uiT = useTranslation();

  const activeCommandStreamsRef = useRef(
    new Map<string, { agentId: string; conversationId: string; toolMessageId: string }>()
  );

  useCommandExecProgress((event) => {
    if (event.done) {
      activeCommandStreamsRef.current.delete(event.stream_id);
      return;
    }
    // 只处理 stdout 流，避免 stdout/stderr 同时输出相同内容导致文本重复
    if (event.started || !event.chunk || event.stream !== 'stdout') return;

    const active = activeCommandStreamsRef.current.get(event.stream_id);
    if (!active) return;

    setConversationState((prev) => {
      const conversations = prev.conversations.map((conv) => {
        if (conv.id !== active.conversationId) return conv;
        const messages = conv.messages.map((msg) => {
          if (msg.id !== active.toolMessageId) return msg;
          return {
            ...msg,
            text: `${msg.text || ''}${event.chunk}`,
            isStreaming: true,
          };
        });
        return { ...conv, messages, updatedAt: Date.now() };
      });
      return { ...prev, conversations };
    });
  });

  const continueWithToolResults = async (
    agentId: string,
    conversationId: string,
    agent: Agent,
    toolMessages: ChatMessage[],
    pendingToolCalls?: ToolCall[],
    sourceAssistantMessageId?: string
  ) => {
    const sessionKey = buildPendingSessionKey(activeProjectKeyRef.current, conversationId);

    if (consumeStopRequest(sessionKey)) {
      if (sourceAssistantMessageId) {
        setConversationState((prev) => {
          const conversations = prev.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv;
            return {
              ...conv,
              messages: conv.messages.map((msg) =>
                msg.id === sourceAssistantMessageId ? { ...msg, isProcessingTools: false } : msg
              ),
            };
          });
          return { ...prev, conversations };
        });
        clearTrackedStream(sourceAssistantMessageId);
      }
      return;
    }

    const newAssistantMessageId = createAssistantMessageId();
    const newAssistantMessage: ChatMessage = {
      id: newAssistantMessageId,
      role: 'assistant',
      text: '',
      thinking: '',
      isStreaming: true,
      isThinking: false,
      createdAt: Date.now(),
    };

    trackStream(newAssistantMessageId, {
      agentId,
      conversationId,
      sessionKey: buildPendingSessionKey(activeProjectKeyRef.current, conversationId),
    });
    if (sourceAssistantMessageId) {
      clearTrackedStream(sourceAssistantMessageId);
    }

    setConversationState((prev) => {
      const conversations = prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv;
        return {
          ...conv,
          updatedAt: Date.now(),
          messages: [
            ...conv.messages.map((msg) =>
              msg.id === sourceAssistantMessageId ? { ...msg, isProcessingTools: false } : msg
            ),
            newAssistantMessage,
          ],
        };
      });
      return { ...prev, conversations };
    });

    try {
      const currentState = conversationStateRef.current;
      const currentConversation = currentState.conversations.find(
        (c) => c.id === conversationId
      );
      const baseMessages = [...(currentConversation?.messages ?? [])].filter(
        (msg) => msg.id !== newAssistantMessageId
      );

      if (pendingToolCalls && pendingToolCalls.length > 0 && sourceAssistantMessageId) {
        for (let i = baseMessages.length - 1; i >= 0; i--) {
          const msg = baseMessages[i];
          if (!msg || msg.id !== sourceAssistantMessageId || msg.role !== 'assistant') continue;
          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            baseMessages[i] = { ...msg, tool_calls: pendingToolCalls };
          }
          break;
        }
      } else if (pendingToolCalls && pendingToolCalls.length > 0) {
        for (let i = baseMessages.length - 1; i >= 0; i--) {
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

      const resolvedRuntime = resolveAgentRequestRuntime(agent, agentRuntimeRef.current);
      let provider = resolvedRuntime.provider;
      let model = resolvedRuntime.model;
      let profileId = resolvedRuntime.profileId;

      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const reconciled = reconcileRuntimeForAgentRequest(
            JSON.parse(configStr),
            agent,
            agentRuntimeRef.current,
            { reuseActiveEntry: true }
          );
          if (reconciled) {
            provider = reconciled.provider;
            model = reconciled.model;
            profileId = reconciled.profileId;
          }
        }
      } catch {
        // keep resolved runtime when config cannot be loaded
      }

      syncReconciledRuntimeIfChanged(
        agentRuntimeRef,
        { provider, model, profileId },
        onRuntimeReconciled,
        { skipUiSync: agentRuntimeRef.current.routingMode === 'auto' }
      );

      const tools = getProviderTools(provider, agentId);

      const {
        preparedMessages: trimmedMsgs,
        compressed,
        messages: compactedMessages,
        compactState,
      } = await buildAgentRequestContext({
        agent,
        provider,
        model,
        conversation: currentConversation ?? null,
        messages: allStableMessages,
        projectPath: projectPathRef.current,
        agentMode: agentModesRef.current[agent.id] ?? 'always-allow',
        tools,
        profileId,
      });

      if (compressed) {
        showInfo(uiT.chat.contextCompressionHint);
        setConversationState((prev) => ({
          ...prev,
          conversations: prev.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [
                    ...compactedMessages,
                    ...conv.messages.filter((m) => m.isStreaming),
                  ],
                  compactState,
                  updatedAt: Date.now(),
                }
              : conv
          ),
        }));
      }

      // Post-tool-call delay: allow frontend UI to update before next stream
      const tcDelay = useSettingsStore.getState().toolCallDelay;
      if (tcDelay > 0) {
        await new Promise((r) => setTimeout(r, tcDelay));
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: newAssistantMessageId,
        model,
        profileId: profileId ?? agent.profileId,
        enableAutoRouting: agentRuntimeRef.current.routingMode === 'auto',
        messages: trimmedMsgs,
        tools,
        toolChainConfig: {
          enableBackendOrchestration: true,
          maxRounds: 10,
          projectPath: projectPathRef.current,
          appDataPath: (await getAppDataPath()) ?? undefined,
          toolCallDelayMs: useSettingsStore.getState().toolCallDelay,
        },
      });
    } catch (err) {
      console.error('[Agent] 继续对话失败:', err);
      setError(t.errors.continueConversationFailed);
      setConversationState((prev) => {
        const conversations = prev.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv;
          return {
            ...conv,
            messages: conv.messages.map((msg) =>
              msg.id === newAssistantMessageId
                ? { ...msg, isStreaming: false, isProcessingTools: false }
                : msg
            ),
          };
        });
        return { ...prev, conversations };
      });
      clearTrackedStream(newAssistantMessageId);
    }
  };

  const clearProcessingState = (
    _agentId: string,
    conversationId: string,
    assistantMessageId: string,
    pendingToolMessages: ChatMessage[] = []
  ) => {
    setConversationState((prev) => {
      const conversations = prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const nextMessages = conv.messages.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, isProcessingTools: false } : msg
        );
        return {
          ...conv,
          updatedAt: Date.now(),
          messages:
            pendingToolMessages.length > 0
              ? mergeAgentMessages(nextMessages, pendingToolMessages)
              : nextMessages,
        };
      });
      return { ...prev, conversations };
    });
  };

  const handleToolCalls = async (
    toolCalls: ToolCall[],
    agentId: string,
    conversationId: string,
    assistantMessageId: string
  ) => {
    logDebug('处理工具调用: ' + JSON.stringify(toolCalls), 'Agent');

    const agent = agentRef.current;
    if (!agent) {
      console.error('[Agent] 未找到 agent:', agentId);
      clearTrackedStream(assistantMessageId);
      return;
    }

    const sessionKey = buildPendingSessionKey(activeProjectKeyRef.current, conversationId);

    if (isStopRequested(sessionKey)) {
      clearTrackedStream(assistantMessageId);
      return;
    }

    // Mark the assistant message as processing tools
    setConversationState((prev) => {
      const conversations = prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv;
        return {
          ...conv,
          messages: conv.messages.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, tool_calls: toolCalls, isProcessingTools: true }
              : msg
          ),
        };
      });
      return { ...prev, conversations };
    });

    const toolMessages: ChatMessage[] = [];
    const changedFiles: string[] = [];

    const resolvedRuntime = resolveAgentRequestRuntime(agent, agentRuntimeRef.current);
    let parentProvider = resolvedRuntime.provider;
    let parentModel = resolvedRuntime.model;
    let profileId = resolvedRuntime.profileId ?? agent.profileId;
    try {
      const configStr = await invoke<string>('load_ai_config');
      if (configStr) {
        const reconciled = reconcileRuntimeForAgentRequest(
          JSON.parse(configStr),
          agent,
          agentRuntimeRef.current,
          { reuseActiveEntry: true }
        );
        if (reconciled) {
          parentProvider = reconciled.provider;
          parentModel = reconciled.model;
          profileId = reconciled.profileId ?? agent.profileId;
        }
      }
    } catch {
      // keep resolved runtime when config cannot be loaded
    }

    syncReconciledRuntimeIfChanged(
      agentRuntimeRef,
      { provider: parentProvider, model: parentModel, profileId },
      onRuntimeReconciled,
      { skipUiSync: agentRuntimeRef.current.routingMode === 'auto' }
    );

    const rawTools = getAgentToolDefinitions(agentId);
    const parentToolNames = rawTools.map((t) => t.name).filter(Boolean);
    const mcpTools = useToolStore.getState().mcpTools;
    const conversationState = conversationStateRef.current.conversations.find(
      (c) => c.id === conversationId
    );
    const parentMessages =
      conversationState?.messages.filter(
        (msg) => !msg.isStreaming || msg.id === assistantMessageId
      ) ?? [];

    const executionId = `ui-agent-${conversationId}-${assistantMessageId}-${Date.now()}`;
    await beginSandboxExecution({
      executionId,
      sessionId: conversationId,
      label: 'agent-panel',
      projectPath: projectPathRef.current?.trim() || undefined,
    });

    try {
    for (const toolCall of toolCalls) {
      if (isStopRequested(sessionKey)) {
        break;
      }

      let parsedArgs: Record<string, unknown> = {};

      try {
        logDebug(`执行工具: ${toolCall.function.name}`, 'Agent');

        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          // ignore parse errors
        }
        parsedArgs = normalizeToolArgs(parsedArgs, toolCall.function.name) as Record<string, unknown>;
        if (shouldBlockTool(agentAccessMode, toolCall.function.name)) {
          toolMessages.push({
            id: `${Date.now()}-tool-${toolCall.id}`,
            role: 'tool',
            text: t.settingsAgent.commandExecution.blockedByPolicy,
            tool_call_id: toolCall.id,
            tool_name: resolveUnderlyingToolName(toolCall.function.name, parsedArgs),
            tool_args: parsedArgs,
            createdAt: Date.now(),
          });
          continue;
        }

        const underlyingToolName = resolveUnderlyingToolName(toolCall.function.name, parsedArgs);
        const summary = buildApprovalSummary(
          toolCall,
          parsedArgs,
          underlyingToolName,
          undefined,
          undefined,
          t.settingsAgent.chatToolApproval
        );
        const needsApproval =
          shouldRequestApproval(agentAccessMode, toolCall.function.name) ||
          requiresConfirmation(toolCall.function.name, parsedArgs, agentAccessMode) ||
          (summary !== null && needsAgentApproval(agentAccessMode, toolCall, parsedArgs, summary));

        if (needsApproval) {
          const approvalSummary =
            summary ??
            ({
              type: 'command',
              toolName: toolCall.function.name,
              label: t.settingsAgent.chatToolApproval.commandType,
              detail:
                typeof parsedArgs.command === 'string'
                  ? parsedArgs.command
                  : typeof parsedArgs.path === 'string'
                    ? parsedArgs.path
                    : toolCall.function.name,
            } satisfies ChatApprovalSummary);

          const toolMessageId = buildAgentToolMessageId(toolCall.id);
          const pendingMsg: ChatMessage = {
            id: toolMessageId,
            role: 'tool',
            text: '',
            tool_call_id: toolCall.id,
            tool_name: resolveUnderlyingToolName(toolCall.function.name, parsedArgs),
            tool_args: parsedArgs,
            approvalStatus: 'pending',
            approvalSummary,
            createdAt: Date.now(),
          };
          upsertAgentToolMessage(conversationId, pendingMsg, setConversationState);

          const approved = await onRequestApproval({
            messageId: toolMessageId,
            summary: approvalSummary,
          });

          if (!approved) {
            const rejectedMsg: ChatMessage = {
              ...pendingMsg,
              approvalStatus: 'rejected',
              text: buildToolApprovalRejectionText(
                pendingMsg.tool_name || toolCall.function.name,
                parsedArgs,
                t.agent.approvalDialog
              ),
              isError: true,
            };
            upsertAgentToolMessage(conversationId, rejectedMsg, setConversationState);
            toolMessages.push(rejectedMsg);
            continue;
          }

          upsertAgentToolMessage(
            conversationId,
            {
              ...pendingMsg,
              approvalStatus: 'approved',
            },
            setConversationState
          );
        }

        // Capability check
        const capabilityForCheck = agent.capabilities
          ? { ...agent.capabilities, canExecuteCommands: true }
          : agent.capabilities;
        const blockedBy = getToolBlockedByCapability(toolCall.function.name, capabilityForCheck);
        if (blockedBy) {
          toolMessages.push({
            id: `${Date.now()}-tool-${toolCall.id}`,
            role: 'tool',
            text: `${t.errors.permissionDeniedAction}: ${toolCall.function.name}`,
            tool_call_id: toolCall.id,
            tool_name: resolveUnderlyingToolName(toolCall.function.name, parsedArgs),
            tool_args: parsedArgs,
            createdAt: Date.now(),
          });
          continue;
        }

        // Plan mode check
        const isAgentPlanMode =
          (agentModesRef.current[agent.id] ?? 'always-allow') === 'plan';
        if (isAgentPlanMode && isToolBlockedInPlanMode(toolCall.function.name)) {
          toolMessages.push({
            id: `${Date.now()}-tool-${toolCall.id}`,
            role: 'tool',
            text: `${t.agent.planModeBlocked}: ${toolCall.function.name}`,
            tool_call_id: toolCall.id,
            tool_name: resolveUnderlyingToolName(toolCall.function.name, parsedArgs),
            tool_args: parsedArgs,
            createdAt: Date.now(),
          });
          continue;
        }

        // For write tools, capture before-content before execution
        const isWriteTool = WRITE_TOOLS.has(toolCall.function.name);
        let beforeContent: string | null = null;
        let existedBefore = false;
        const changedFilePath = isWriteTool
          ? ((parsedArgs.file_path ?? parsedArgs.file ?? parsedArgs.path ?? '') as string)
          : '';
        /** 与 fileHandlers 内 resolvePathWithBaseDir 一致，保证快照路径与 files_changed 一致 */
        let resolvedWriteTargetPath = '';
        if (isWriteTool && changedFilePath) {
          const baseDir = projectPathRef.current?.trim() || undefined;
          resolvedWriteTargetPath = baseDir
            ? resolvePathWithBaseDir(String(changedFilePath).trim(), baseDir)
            : String(changedFilePath).trim();

          try {
            const fileInfo = await invoke<{ exists?: boolean }>('get_file_info', {
              path: resolvedWriteTargetPath,
            });
            existedBefore = fileInfo?.exists === true;
          } catch {
            // Best-effort existence check only
          }
          try {
            beforeContent = await invoke<string>('read_file_content', {
              filePath: resolvedWriteTargetPath,
            });
            existedBefore = true;
          } catch {
            // File doesn't exist yet — beforeContent stays null (new file)
          }
        }

        // Execute the tool
        const isGenerateImage = toolCall.function.name === 'generate_image';
        const isRunCommand = isRunCommandToolName(toolCall.function.name, parsedArgs);
        const isRunSubagent = toolCall.function.name === 'run_subagent';
        const isRunSubagents = toolCall.function.name === 'run_subagents';
        const isAgentTool = toolCall.function.name === 'Agent' || toolCall.function.name === 'Task';
        const isSubagentTool = isRunSubagent || isRunSubagents || isAgentTool;
        const subagentsEnabled = isSubagentsEnabled();
        const toolMessageId = buildAgentToolMessageId(toolCall.id);
        const resolvedToolName = isRunCommand
          ? 'run_command'
          : resolveUnderlyingToolName(toolCall.function.name, parsedArgs);

        if (isGenerateImage || isRunCommand || (subagentsEnabled && isSubagentTool)) {
          if (subagentsEnabled && isSubagentTool) {
            bootstrapSubagentFromToolArgs(toolCall.id, parsedArgs);
          }
          if (isRunCommand) {
            activeCommandStreamsRef.current.set(toolCall.id, {
              agentId,
              conversationId,
              toolMessageId,
            });
          }
          upsertAgentToolMessage(
            conversationId,
            {
              id: toolMessageId,
              role: 'tool',
              text: '',
              isStreaming: true,
              tool_call_id: toolCall.id,
              tool_name: resolvedToolName,
              tool_args: parsedArgs,
              createdAt: Date.now(),
            },
            setConversationState
          );
        }

        const mcpToolsForCall = mcpTools;

        const result = await executeToolCall(toolCall, {
          baseDir: projectPathRef.current || undefined,
          agentId,
          conversationId,
          toolCallId: toolCall.id,
          parentProvider,
          parentModel,
          profileId,
          maxContextTokens: agent.maxContextTokens,
          parentToolNames,
          parentMcpTools: mcpToolsForCall,
          parentMessages,
          subagentDepth: 0,
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
        });

        if (result.files_changed && result.files_changed.length > 0) {
          changedFiles.push(...result.files_changed.filter((p) => typeof p === 'string' && p.trim()));
        }

        // For write tools, create pending change entry
        if (isWriteTool && result.files_changed && result.files_changed.length > 0 && !result.error) {
          for (const filePath of result.files_changed) {
            if (typeof filePath !== 'string' || !filePath.trim()) continue;
            try {
              const afterContent: string = await invoke('read_file_content', { filePath });
              const normalizedChanged = normalizePathForCompare(filePath).toLowerCase();
              const normalizedResolved = normalizePathForCompare(
                resolvedWriteTargetPath || changedFilePath
              ).toLowerCase();
              const normalizedArg = normalizePathForCompare(changedFilePath).toLowerCase();
              const pathsMatch =
                normalizedChanged === normalizedResolved ||
                normalizedChanged === normalizedArg ||
                normalizedResolved.endsWith(`\\${normalizedChanged}`) ||
                normalizedResolved.endsWith(`/${normalizedChanged}`);
              const before = pathsMatch ? beforeContent : null;
              const now = Date.now();
              const sessionKey = buildPendingSessionKey(activeProjectKeyRef.current, conversationId);
              const normalizedFilePath = normalizePathForCompare(filePath).toLowerCase();
              const nextOldSnippet =
                typeof parsedArgs.old_string === 'string' || typeof parsedArgs.old === 'string'
                  ? (parsedArgs.old_string ?? parsedArgs.old) as string
                  : undefined;
              const nextNewSnippet =
                typeof parsedArgs.new_string === 'string' || typeof parsedArgs.new === 'string'
                  ? (parsedArgs.new_string ?? parsedArgs.new) as string
                  : undefined;
              onSetPendingChangesBySession((prev) => {
                const existing = prev[sessionKey] ?? [];
                const existingChange = existing.find(
                  (c) => normalizePathForCompare(c.filePath).toLowerCase() === normalizedFilePath
                );
                const pendingChange: PendingFileChange = {
                  id:
                    existingChange?.id ??
                    `pc-${now}-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
                  agentId: activeProjectKeyRef.current,
                  conversationId,
                  filePath,
                  existedBefore: existingChange?.existedBefore ?? existedBefore,
                  beforeContent:
                    existingChange?.beforeContent !== undefined
                      ? existingChange.beforeContent
                      : before,
                  afterContent,
                  toolName: toolCall.function.name,
                  oldSnippet: nextOldSnippet,
                  newSnippet: nextNewSnippet,
                  createdAt: existingChange?.createdAt ?? now,
                  updatedAt: now,
                };
                const next = existing.filter(
                  (c) => normalizePathForCompare(c.filePath).toLowerCase() !== normalizedFilePath
                );
                return { ...prev, [sessionKey]: [...next, pendingChange] };
              });

              // Add preview history entry
              setConversationState((prev) => {
                const conversations = prev.conversations.map((conv) => {
                  if (conv.id !== conversationId) return conv;
                  const existingEntry = conv.previewHistory.find(
                    (e) =>
                      normalizePathForCompare(e.filePath).toLowerCase() === normalizedFilePath
                  );
                  const entry = {
                    filePath,
                    content: afterContent,
                    originalContent: existingEntry?.originalContent ?? before ?? '',
                    modifiedContent: afterContent,
                  };
                  const merged = [...conv.previewHistory];
                  const idx = merged.findIndex(
                    (e) =>
                      normalizePathForCompare(e.filePath).toLowerCase() === normalizedFilePath
                  );
                  if (idx >= 0) {
                    merged[idx] = entry;
                  } else {
                    merged.push(entry);
                  }
                  if (merged.length > MAX_PREVIEW_HISTORY) {
                    merged.splice(0, merged.length - MAX_PREVIEW_HISTORY);
                  }
                  return {
                    ...conv,
                    previewHistory: merged,
                    currentPreviewIndex: merged.length - 1,
                  };
                });
                return { ...prev, conversations };
              });
            } catch {
              // File may be inaccessible — skip pending change
            }
          }
        }

        let completedToolMessage: ChatMessage = {
          id: toolMessageId,
          role: 'tool',
          text: result.error || result.output,
          tool_call_id: toolCall.id,
          tool_name: resolvedToolName,
          tool_args: parsedArgs,
          createdAt: Date.now(),
          isError: !!result.error,
          isStreaming: false,
        };
        if (subagentsEnabled && isSubagentTool) {
          completedToolMessage = attachSubagentRunsSnapshot(
            completedToolMessage,
            toolCall.id,
            toolCall.function.name
          );
        }
        toolMessages.push(completedToolMessage);

        activeCommandStreamsRef.current.delete(toolCall.id);

        if (isGenerateImage || isRunCommand || (subagentsEnabled && isSubagentTool)) {
          upsertAgentToolMessage(conversationId, toolMessages[toolMessages.length - 1], setConversationState);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        let failedToolMessage: ChatMessage = {
          id: buildAgentToolMessageId(toolCall.id),
          role: 'tool',
          text: `工具执行错误: ${errorMsg}`,
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          createdAt: Date.now(),
          isError: true,
          isStreaming: false,
        };
        const failedIsSubagentTool =
          isSubagentsEnabled() &&
          (toolCall.function.name === 'run_subagent' ||
            toolCall.function.name === 'run_subagents' ||
            toolCall.function.name === 'Agent' ||
            toolCall.function.name === 'Task');
        if (failedIsSubagentTool) {
          failedToolMessage = attachSubagentRunsSnapshot(
            failedToolMessage,
            toolCall.id,
            toolCall.function.name
          );
        }
        toolMessages.push(failedToolMessage);
        activeCommandStreamsRef.current.delete(toolCall.id);
        if (
          toolCall.function.name === 'generate_image' ||
          isRunCommandToolName(toolCall.function.name, parsedArgs) ||
          failedIsSubagentTool
        ) {
          upsertAgentToolMessage(conversationId, failedToolMessage, setConversationState);
        }
      }

      if (isStopRequested(sessionKey)) {
        break;
      }
    }
    } finally {
      await endSandboxExecution(executionId);
    }

    // Notify file changes
    if (changedFiles.length > 0) {
      const unique = Array.from(new Set(changedFiles));
      onFilesChangedRef.current?.(unique);
    }

    if (isStopRequested(sessionKey)) {
      clearProcessingState(agentId, conversationId, assistantMessageId, toolMessages);
      clearTrackedStream(assistantMessageId);
      return;
    }

    // Add tool result messages to conversation
    setConversationState((prev) => {
      const conversations = prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const merged = mergeAgentMessages(conv.messages, toolMessages);
        const { messages: agedMessages } = agePersistedChatToolMessages(merged);
        return {
          ...conv,
          updatedAt: Date.now(),
          messages: agedMessages,
        };
      });
      return { ...prev, conversations };
    });

    await continueWithToolResults(
      agentId,
      conversationId,
      agent,
      toolMessages,
      toolCalls,
      assistantMessageId
    );
  };

  // Assign the ref so useAgentStreamEvents can call it
  handleToolCallsRef.current = handleToolCalls;
}
