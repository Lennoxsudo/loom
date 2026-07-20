import { useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  type Agent,
  type AIProvider,
} from '../../../utils/agentPersistence';
import { DEFAULT_VISION_CAPABILITIES } from '../../../utils/visionCapabilities';
import type { FileAttachment, PendingImageAttachment } from '../../../types/chat';
import type {
  ChatMessage,
  AgentConversationState,
  StreamMeta,
} from '../../../types/chat';
import {
  isManualCancelError,
  createAgentConversation,
  normalizeProjectPath,
  buildPendingSessionKey,
  createAssistantMessageId,
  createUserMessageId,
} from '../utils';
import {
  autoGenerateAgentConversationTitle,
  buildInstantAgentConversationTitle,
  shouldAutoGenerateAgentTitle,
} from './autoGenerateAgentConversationTitle';
import { getLanguage } from '../../../utils/editorUtils';
import {
  shouldInjectRules,
  getRulesContentHash,
} from '../../../utils/rulesInjector';
import {
  shouldInjectProjectPath as checkShouldInjectProjectPath,
  markInjectionPending,
  commitInjection,
  rollbackInjection,
} from '../../../hooks/useContextInjectionState';
import { listSubagentDefinitions } from '../../../utils/subagents/registry';
import { buildSubagentCatalogBlock } from '../../../utils/subagents/catalog';
import { buildAgentRequestContext } from '../contextUsage';
import { reconcileRuntimeForAgentRequest, resolveAgentRequestRuntime, syncReconciledRuntimeIfChanged, type AgentRuntimeSnapshot } from '../utils';
import { useNotification } from '../../../contexts/NotificationContext';
import { useTranslation } from '../../../i18n';
import { updateAgentConversationById } from './agentConversationUpdates';
import { useCheckpointStore } from '../../../stores/useCheckpointStore';
import {
  collectUserMessageIdsFromIndex,
  findEarliestCheckpointForUserTurns,
} from '../../../utils/checkpointTimeline';
import type { PendingFileChange } from '../utils';
import {
  expandSkillSlashCommand,
  formatSlashCommandDisplay,
} from '../../../utils/skillSlashCommand';

export interface UseAgentSendMessageOptions {
  draftMessage: string;
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  selectedConversationId: string | null;
  isSelectedSessionBusy: boolean;
  projectBranchNameRef: React.MutableRefObject<string | null>;
  threadSettingsRef: React.MutableRefObject<import('../../../types/chat').AgentThreadSettings | undefined>;
  agentRuntimeRef: React.MutableRefObject<AgentRuntimeSnapshot>;
  attachedImages: PendingImageAttachment[];
  attachedFiles: { id: string; path: string; name: string }[];
  visionCapabilities: Record<string, { supportsVision: boolean; visionMaxImages: number }>;
  agentModesRef: React.MutableRefObject<Record<string, 'plan' | 'always-allow'>>;
  projectPathRef: React.MutableRefObject<string>;
  activeProjectKeyRef: React.MutableRefObject<string>;
  conversationStateRef: React.MutableRefObject<AgentConversationState>;
  draftTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setDraftMessage: (msg: string) => void;
  setConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
  setError: (msg: string | null) => void;
  clearAttachedImages: () => void;
  clearAttachedFiles: () => void;
  consumeStopRequest: (sessionKey: string) => boolean;
  trackStream: (messageId: string, meta: StreamMeta) => void;
  clearTrackedStream: (messageId: string) => StreamMeta | null;
  getProviderTools: (provider: AIProvider, currentAgentId?: string) => unknown[];
  getAppDataPath: () => Promise<string | null>;
  autoTitleRequestedRef: React.MutableRefObject<Set<string>>;
  sendFailedText: string;
  visionUnsupportedError: string;
  onRuntimeReconciled?: (runtime: AgentRuntimeSnapshot) => void;
  onUserMessageSent?: () => void;
  getCurrentThreadSettings?: () => import('../../../types/chat').AgentThreadSettings | undefined;
  /** Stop active stream before editing/resending a past user message. */
  stopStreaming?: () => Promise<void>;
  onSetPendingChangesBySession?: React.Dispatch<
    React.SetStateAction<Record<string, PendingFileChange[]>>
  >;
  onFilesChanged?: (paths: string[]) => void;
}

export interface SendMessageOverrides {
  draftMessage?: string;
}

export function useAgentSendMessage(options: UseAgentSendMessageOptions) {
  const {
    draftMessage,
    selectedAgentId,
    selectedAgent,
    selectedConversationId,
    isSelectedSessionBusy,
    projectBranchNameRef,
    threadSettingsRef,
    agentRuntimeRef,
    attachedImages,
    attachedFiles,
    visionCapabilities,
    agentModesRef,
    projectPathRef,
    activeProjectKeyRef,
    conversationStateRef,
    draftTextareaRef,
    setDraftMessage,
    setConversationState,
    setError,
    clearAttachedImages,
    clearAttachedFiles,
    consumeStopRequest,
    trackStream,
    clearTrackedStream,
    getProviderTools,
    getAppDataPath,
    autoTitleRequestedRef,
    sendFailedText,
    visionUnsupportedError,
    onRuntimeReconciled,
    onUserMessageSent,
    getCurrentThreadSettings,
    stopStreaming,
    onSetPendingChangesBySession,
    onFilesChanged,
  } = options;

  const { showInfo, showWarning } = useNotification();
  const t = useTranslation();

  // 方法 6：subagentCatalog 缓存化。
  // 缓存 catalog 字符串，仅当 projectPath 变化时重新构建。
  // 外部通过 onFilesChangedRef 触发的文件变更会通过 projectPath 切换自然失效缓存。
  const subagentCatalogCacheRef = useRef<{ path: string; catalog: string } | null>(null);

  /**
   * Edit a past user bubble and resend: restore files mutated after that turn,
   * drop subsequent assistant/tool messages, then stream a fresh reply.
   */
  const resolveUserText = async (raw: string) => {
    const trimmed = raw.trim();
    const expansion = await expandSkillSlashCommand(trimmed, projectPathRef.current || '');
    if (expansion.kind === 'expanded') {
      return {
        text: expansion.expandedText,
        slashCommand: {
          name: expansion.skillName,
          args: expansion.args,
          displayText: formatSlashCommandDisplay(expansion.skillName, expansion.args),
        },
      };
    }
    return { text: trimmed, slashCommand: undefined as undefined };
  };

  const resendFromUserMessage = async (userMessageId: string, newText: string) => {
    if (!newText.trim() || !selectedAgentId || !selectedAgent || !selectedConversationId) {
      return;
    }
    const resolved = await resolveUserText(newText);
    const text = resolved.text;
    const slashCommand = resolved.slashCommand;

    if (isSelectedSessionBusy && stopStreaming) {
      try {
        await stopStreaming();
      } catch {
        // continue — best effort stop
      }
    }

    const conversation = conversationStateRef.current.conversations.find(
      (c) => c.id === selectedConversationId
    );
    if (!conversation) return;

    const msgIndex = conversation.messages.findIndex((m) => m.id === userMessageId);
    if (msgIndex < 0) return;
    const original = conversation.messages[msgIndex];
    if (original.role !== 'user') return;

    const projectPath = projectPathRef.current?.trim() || '';
    const sessionKey = buildPendingSessionKey(activeProjectKeyRef.current, selectedConversationId);

    // Roll back workspace mutations from this user turn onward
    if (projectPath) {
      const store = useCheckpointStore.getState();
      await store.hydrateSession(sessionKey);
      const checkpoints = store.bySession[sessionKey] ?? [];
      const userTurnIds = collectUserMessageIdsFromIndex(conversation.messages, msgIndex);
      const target = findEarliestCheckpointForUserTurns(
        checkpoints,
        userTurnIds,
        original.createdAt
      );
      if (target) {
        const result = await store.restoreToCheckpoint({
          sessionKey,
          checkpointId: target.id,
          projectPath,
        });
        if (result?.success) {
          const touched = [...(result.restoredFiles ?? []), ...(result.deletedFiles ?? [])];
          if (touched.length > 0) onFilesChanged?.(touched);
        } else if (result && !result.success) {
          showWarning(
            t.agent.changeReview.restoreFailed.replace('{error}', result.message || 'unknown')
          );
        }
      }
    }

    // Pending-change first-before snapshots are invalid after time travel
    onSetPendingChangesBySession?.((prev) => {
      if (!prev[sessionKey]) return prev;
      const next = { ...prev };
      delete next[sessionKey];
      return next;
    });

    const keptMessages = conversation.messages.slice(0, msgIndex + 1).map((m, i) =>
      i === msgIndex
        ? {
            ...m,
            text,
            ...(slashCommand ? { slashCommand } : { slashCommand: undefined }),
            createdAt: Date.now(),
          }
        : m
    );
    // Drop streaming stubs after the user message
    const cleanedKept = keptMessages.filter((m) => !(m.isStreaming && m.role === 'assistant'));

    const resolvedRuntime = resolveAgentRequestRuntime(
      selectedAgent,
      agentRuntimeRef.current
    );
    let provider = resolvedRuntime.provider;
    let runtimeModel = resolvedRuntime.model;
    let profileId = resolvedRuntime.profileId;

    try {
      const configStr = await invoke<string>('load_ai_config');
      if (configStr) {
        const config = JSON.parse(configStr);
        const reconciled = reconcileRuntimeForAgentRequest(
          config,
          selectedAgent,
          agentRuntimeRef.current
        );
        if (!reconciled) {
          setError(t.agent.autoRoutingNotConfigured);
          return;
        }
        provider = reconciled.provider;
        runtimeModel = reconciled.model;
        profileId = reconciled.profileId;
      }
    } catch {
      // keep resolved runtime
    }

    if (agentRuntimeRef.current.routingMode !== 'auto' && !runtimeModel) {
      setError('当前未选择可用模型，请在 Agent 输入框上方选择模型，或在设置中配置 models。');
      return;
    }
    if (agentRuntimeRef.current.routingMode === 'auto' && !runtimeModel) {
      setError(t.agent.autoRoutingNotConfigured);
      return;
    }

    syncReconciledRuntimeIfChanged(
      agentRuntimeRef,
      { provider, model: runtimeModel, profileId },
      onRuntimeReconciled,
      { skipUiSync: agentRuntimeRef.current.routingMode === 'auto' }
    );

    setError(null);
    consumeStopRequest(sessionKey);

    const userMessage: ChatMessage = {
      ...cleanedKept[cleanedKept.length - 1],
      role: 'user',
      text,
      ...(slashCommand ? { slashCommand } : { slashCommand: undefined }),
      createdAt: Date.now(),
    };

    const assistantMessageId = createAssistantMessageId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      thinking: '',
      isStreaming: true,
      isThinking: false,
      createdAt: Date.now(),
    };

    trackStream(assistantMessageId, {
      agentId: selectedAgentId,
      conversationId: selectedConversationId,
      sessionKey,
    });

    const messagesForState = [
      ...cleanedKept.slice(0, -1),
      userMessage,
      assistantMessage,
    ];

    setConversationState((prev) =>
      updateAgentConversationById(prev, selectedConversationId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: messagesForState,
      }))
    );

    onUserMessageSent?.();

    let needsInjection = false;
    const mainRequestId = `main_${assistantMessageId}`;
    const activeConversationId = selectedConversationId;

    try {
      const streamConversation = {
        ...conversation,
        messages: messagesForState,
      };
      const previousMessages = messagesForState.filter((msg) => !msg.isStreaming);
      const allMessages = previousMessages;

      needsInjection = checkShouldInjectProjectPath(
        streamConversation,
        projectPathRef.current
      );
      if (needsInjection) {
        markInjectionPending(activeConversationId, mainRequestId);
      }

      const tools = getProviderTools(provider, selectedAgentId) as unknown[];
      const currentAgentMode = agentModesRef.current[selectedAgentId] ?? 'always-allow';

      const needsRulesInjection = shouldInjectRules(
        selectedAgent.rules ?? '',
        !!streamConversation?.contextInjected?.rules?.injected,
        streamConversation?.contextInjected?.rules?.contentHash
      );

      let subagentCatalog: string | undefined;
      const catalogCache = subagentCatalogCacheRef.current;
      if (catalogCache && catalogCache.path === projectPathRef.current) {
        subagentCatalog = catalogCache.catalog;
      } else {
        try {
          const subagents = await listSubagentDefinitions(projectPathRef.current);
          subagentCatalog = buildSubagentCatalogBlock(subagents);
          if (subagentCatalog) {
            subagentCatalogCacheRef.current = {
              path: projectPathRef.current,
              catalog: subagentCatalog,
            };
          }
        } catch {
          // ignore
        }
      }

      const {
        preparedMessages: providerMessages,
        compressed,
        messages: compactedMessages,
        compactState,
      } = await buildAgentRequestContext({
        agent: selectedAgent,
        provider,
        model: runtimeModel,
        conversation: streamConversation,
        messages: allMessages,
        projectPath: projectPathRef.current,
        agentMode: currentAgentMode,
        tools,
        shouldInjectProjectPath: needsInjection,
        subagentCatalog,
        profileId: profileId ?? selectedAgent.profileId,
      });

      if (compressed) {
        showInfo(t.chat.contextCompressionHint);
        setConversationState((prev) =>
          updateAgentConversationById(prev, activeConversationId, (c) => ({
            ...c,
            messages: [
              ...compactedMessages,
              ...c.messages.filter((m) => m.isStreaming),
            ],
            compactState,
            updatedAt: Date.now(),
          }))
        );
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: assistantMessageId,
        model: runtimeModel,
        profileId: profileId ?? selectedAgent.profileId,
        enableAutoRouting: agentRuntimeRef.current.routingMode === 'auto',
        messages: providerMessages,
        tools,
        toolChainConfig: {
          enableBackendOrchestration: true,
          maxRounds: 10,
          projectPath: projectPathRef.current,
          appDataPath: (await getAppDataPath()) ?? undefined,
        },
      });

      if (needsInjection || needsRulesInjection) {
        const injState = needsInjection
          ? commitInjection(activeConversationId, mainRequestId, projectPathRef.current)
          : undefined;
        setConversationState((prev) =>
          updateAgentConversationById(prev, activeConversationId, (c) => {
            const nextInjected = { ...c.contextInjected };
            if (injState) {
              nextInjected.projectPath = injState;
            }
            if (needsRulesInjection) {
              nextInjected.rules = {
                injected: true,
                contentHash: getRulesContentHash(selectedAgent.rules ?? ''),
              };
            }
            return { ...c, contextInjected: nextInjected };
          })
        );
      }
    } catch (sendError) {
      if (!isManualCancelError(sendError)) {
        setError(sendFailedText);
      }
      if (needsInjection) {
        rollbackInjection(activeConversationId, mainRequestId);
      }
      clearTrackedStream(assistantMessageId);
      setConversationState((prev) => {
        const conversations = prev.conversations.map((c) => {
          if (c.id !== activeConversationId) return c;
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.filter((message) => message.id !== assistantMessageId),
          };
        });
        return { ...prev, conversations };
      });
    }
  };

  const sendMessage = async (overrides?: SendMessageOverrides) => {
    const rawDraft = (overrides?.draftMessage ?? draftMessage).trim();
    if (
      (!rawDraft &&
        attachedImages.length === 0 &&
        attachedFiles.length === 0) ||
      !selectedAgentId ||
      !selectedAgent ||
      isSelectedSessionBusy
    ) {
      return;
    }

    const resolved = rawDraft
      ? await resolveUserText(rawDraft)
      : { text: '', slashCommand: undefined as undefined };
    const text = resolved.text;
    const slashCommand = resolved.slashCommand;

    const resolvedRuntime = resolveAgentRequestRuntime(
      selectedAgent,
      agentRuntimeRef.current
    );
    let provider = resolvedRuntime.provider;
    let runtimeModel = resolvedRuntime.model;
    let profileId = resolvedRuntime.profileId;

    try {
      const configStr = await invoke<string>('load_ai_config');
      if (configStr) {
        const config = JSON.parse(configStr);
        const reconciled = reconcileRuntimeForAgentRequest(
          config,
          selectedAgent,
          agentRuntimeRef.current
        );
        if (!reconciled) {
          setError(t.agent.autoRoutingNotConfigured);
          return;
        }
        provider = reconciled.provider;
        runtimeModel = reconciled.model;
        profileId = reconciled.profileId;
      }
    } catch {
      // keep resolved runtime when config cannot be loaded
    }

    if (agentRuntimeRef.current.routingMode !== 'auto' && !runtimeModel) {
      setError('当前未选择可用模型，请在 Agent 输入框上方选择模型，或在设置中配置 models。');
      return;
    }

    if (agentRuntimeRef.current.routingMode === 'auto' && !runtimeModel) {
      setError(t.agent.autoRoutingNotConfigured);
      return;
    }

    syncReconciledRuntimeIfChanged(
      agentRuntimeRef,
      { provider, model: runtimeModel, profileId },
      onRuntimeReconciled,
      { skipUiSync: agentRuntimeRef.current.routingMode === 'auto' }
    );

    const capability = visionCapabilities[provider] || DEFAULT_VISION_CAPABILITIES[provider];

    if (attachedImages.length > 0 && !capability.supportsVision) {
      setError(visionUnsupportedError);
      return;
    }

    if (attachedImages.length > capability.visionMaxImages) {
      setError(`当前模型最多支持 ${capability.visionMaxImages} 张图片`);
      return;
    }

    setError(null);

    const fileAttachments: FileAttachment[] = [];
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        try {
          const content = await invoke<string>('read_file_content', {
            filePath: file.path,
          });
          const language = getLanguage(file.name);
          fileAttachments.push({
            id: file.id,
            path: file.path,
            name: file.name,
            content,
            language,
          });
        } catch (error) {
          fileAttachments.push({
            id: file.id,
            path: file.path,
            name: file.name,
            content: `⚠️ 无法读取文件: ${error}`,
            language: '',
          });
        }
      }
    }

    const pendingConversation =
      selectedConversationId == null
        ? createAgentConversation(
            selectedAgent.id,
            selectedAgent.name,
            projectPathRef.current,
            projectBranchNameRef.current ?? undefined,
            getCurrentThreadSettings?.() ?? threadSettingsRef.current
          )
        : null;
    const activeConversationId = pendingConversation?.id ?? selectedConversationId;
    if (!activeConversationId) {
      return;
    }

    const sessionKey = buildPendingSessionKey(activeProjectKeyRef.current, activeConversationId);
    consumeStopRequest(sessionKey);

    const seededPendingConversation = pendingConversation
      ? {
          ...pendingConversation,
          updatedAt: Date.now(),
          messages: [...pendingConversation.messages],
        }
      : null;

    const userMessage: ChatMessage = {
      id: createUserMessageId(),
      role: 'user',
      text: text || '',
      ...(slashCommand ? { slashCommand } : {}),
      ...(attachedImages.length > 0
        ? {
            attachments: attachedImages.map(({ previewUrl: _, ...attachment }) => attachment),
          }
        : {}),
      ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
      createdAt: Date.now(),
    };

    const assistantMessageId = createAssistantMessageId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      thinking: '',
      isStreaming: true,
      isThinking: false,
      createdAt: Date.now(),
    };

    trackStream(assistantMessageId, {
      agentId: selectedAgentId,
      conversationId: activeConversationId,
      sessionKey,
    });

    const titleSourceConversation =
      pendingConversation ??
      conversationStateRef.current?.conversations.find((conv) => conv.id === activeConversationId);
    const preSendMessageCount = titleSourceConversation
      ? titleSourceConversation.messages.filter((message) => !message.isStreaming).length
      : 0;
    const shouldGenerateTitle = shouldAutoGenerateAgentTitle({
      titleGenerated: titleSourceConversation?.titleGenerated,
      title: titleSourceConversation?.title,
      preSendMessageCount,
    });
    const instantTitle = shouldGenerateTitle
      ? buildInstantAgentConversationTitle(
          slashCommand?.displayText ?? text,
          fileAttachments.map((file) => file.name)
        )
      : null;

    setConversationState((prev) => {
      let conversations = prev.conversations;

      if (pendingConversation && seededPendingConversation) {
        conversations = [
          ...conversations,
          {
            ...seededPendingConversation,
            title: instantTitle ?? seededPendingConversation.title,
            messages: [...seededPendingConversation.messages, userMessage, assistantMessage],
          },
        ];
      } else {
        conversations = updateAgentConversationById(prev, activeConversationId, (conversation) => {
          const nextMessages = [...conversation.messages, userMessage, assistantMessage];
          return {
            ...conversation,
            updatedAt: Date.now(),
            title: instantTitle ?? conversation.title,
            messages: nextMessages,
          };
        }).conversations;
      }

      return {
        ...prev,
        selectedConversationId: activeConversationId,
        selectedConversationIdByProject: {
          ...(prev.selectedConversationIdByProject ?? {}),
          [normalizeProjectPath(projectPathRef.current)]: activeConversationId,
        },
        conversations,
      };
    });
    setDraftMessage('');
    clearAttachedFiles();
    clearAttachedImages();
    if (draftTextareaRef.current) {
      draftTextareaRef.current.style.height = 'auto';
    }

    onUserMessageSent?.();

    if (shouldGenerateTitle) {
      void autoGenerateAgentConversationTitle({
        conversationId: activeConversationId,
        provider,
        model: runtimeModel,
        profileId: profileId ?? selectedAgent.profileId,
        userText: slashCommand?.displayText ?? text,
        fileNames: fileAttachments.map((file) => file.name),
        autoTitleRequestedRef,
        conversationStateRef,
        setConversationState,
      });
    }

    let needsInjection = false;
    const mainRequestId = `main_${assistantMessageId}`;

    try {
      // Cloud Agent branch
      const streamState = conversationStateRef.current;
      const streamConversation =
        streamState?.conversations.find((conv) => conv.id === activeConversationId) ??
        (seededPendingConversation
          ? {
              ...seededPendingConversation,
              messages: [...seededPendingConversation.messages, userMessage, assistantMessage],
            }
          : null);
      const previousMessages = (streamConversation?.messages ?? []).filter(
        (msg) => !msg.isStreaming
      );
      const allMessages = [...previousMessages, userMessage];

      needsInjection = checkShouldInjectProjectPath(streamConversation ?? undefined, projectPathRef.current);
      if (needsInjection) {
        markInjectionPending(activeConversationId, mainRequestId);
      }

      const tools = getProviderTools(provider, selectedAgentId) as unknown[];
      const currentAgentMode = agentModesRef.current[selectedAgentId] ?? 'always-allow';

      const needsRulesInjection = shouldInjectRules(
        selectedAgent.rules ?? '',
        !!streamConversation?.contextInjected?.rules?.injected,
        streamConversation?.contextInjected?.rules?.contentHash,
      );

      let subagentCatalog: string | undefined;
      const catalogCache = subagentCatalogCacheRef.current;
      if (catalogCache && catalogCache.path === projectPathRef.current) {
        subagentCatalog = catalogCache.catalog;
      } else {
        try {
          const subagents = await listSubagentDefinitions(projectPathRef.current);
          subagentCatalog = buildSubagentCatalogBlock(subagents);
          if (subagentCatalog) {
            subagentCatalogCacheRef.current = {
              path: projectPathRef.current,
              catalog: subagentCatalog,
            };
          }
        } catch {
          // ignore catalog load errors in non-Tauri environments
        }
      }

      const {
        preparedMessages: providerMessages,
        compressed,
        messages: compactedMessages,
        compactState,
      } = await buildAgentRequestContext({
        agent: selectedAgent,
        provider,
        model: runtimeModel,
        conversation: streamConversation,
        messages: allMessages,
        projectPath: projectPathRef.current,
        agentMode: currentAgentMode,
        tools,
        shouldInjectProjectPath: needsInjection,
        subagentCatalog,
        profileId: profileId ?? selectedAgent.profileId,
      });

      if (compressed) {
        showInfo(t.chat.contextCompressionHint);
        setConversationState((prev) =>
          updateAgentConversationById(prev, activeConversationId, (c) => ({
            ...c,
            messages: [
              ...compactedMessages,
              ...c.messages.filter((m) => m.isStreaming),
            ],
            compactState,
            updatedAt: Date.now(),
          }))
        );
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: assistantMessageId,
        model: runtimeModel,
        profileId: profileId ?? selectedAgent.profileId,
        enableAutoRouting: agentRuntimeRef.current.routingMode === 'auto',
        messages: providerMessages,
        tools,
        toolChainConfig: {
          enableBackendOrchestration: true,
          maxRounds: 10,
          projectPath: projectPathRef.current,
          appDataPath: (await getAppDataPath()) ?? undefined,
        },
      });

      // Commit injection state on success
      if (needsInjection || needsRulesInjection) {
        const injState = needsInjection
          ? commitInjection(activeConversationId, mainRequestId, projectPathRef.current)
          : undefined;
        setConversationState((prev) =>
          updateAgentConversationById(prev, activeConversationId, (c) => {
            const nextInjected = { ...c.contextInjected };
            if (injState) {
              nextInjected.projectPath = injState;
            }
            if (needsRulesInjection) {
              nextInjected.rules = {
                injected: true,
                contentHash: getRulesContentHash(selectedAgent.rules ?? ''),
              };
            }
            return { ...c, contextInjected: nextInjected };
          })
        );
      }
    } catch (sendError) {
      if (!isManualCancelError(sendError)) {
        setError(sendFailedText);
      }
      if (needsInjection) {
        rollbackInjection(activeConversationId, mainRequestId);
      }
      clearTrackedStream(assistantMessageId);
      setConversationState((prev) => {
        const conversations = prev.conversations.map((conversation) => {
          if (conversation.id !== activeConversationId) return conversation;
          return {
            ...conversation,
            updatedAt: Date.now(),
            messages: conversation.messages.filter((message) => message.id !== assistantMessageId),
          };
        });
        return {
          ...prev,
          conversations,
        };
      });
    }
  };

  return { sendMessage, resendFromUserMessage };
}
