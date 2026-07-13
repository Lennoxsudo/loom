import { invoke } from '@tauri-apps/api/core';
import { estimateMessageTokens } from '../../utils/contextBudget';
import { sanitizeMessagesForIpc } from '../../features/agent-engine';
import { toChatPanelProviderRequestMessages, VISION_UNSUPPORTED_ERROR } from './types';
import { buildChatContextUsage } from './contextUsage';
import { buildConversationPayload } from './conversationPersist';
import {
  rebuildChatUserMessageContent,
  buildChatCheckpointSessionKey,
  splitChatUserMessageContent,
} from './chatUserMessageEdit';
import {
  reconcileChatRequestRuntime,
  syncChatRuntimeIfChanged,
  type ChatRuntimeSnapshot,
} from './chatRoutingRuntime';
import type {
  Message,
  AttachedFile,
  PendingImageAttachment,
  Conversation,
  ConversationMeta,
  ChatProtocolSelection,
} from './types';
import type { AIProvider } from '../../utils/visionCapabilities';
import type { VisionCapability } from '../../utils/visionCapabilities';
import { ToolGuard } from '../../utils/toolGuard';
import { logDebug } from '../../utils/errorHandling';
import { useNotification } from '../../contexts/NotificationContext';
import { useTranslation } from '../../i18n';
import { useCheckpointStore } from '../../stores/useCheckpointStore';
import {
  collectUserMessageIdsFromIndex,
  findEarliestCheckpointForUserTurns,
} from '../../utils/checkpointTimeline';

export interface UseSendMessageOptions {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  attachedFiles: AttachedFile[];
  attachedImages: PendingImageAttachment[];
  isLoading: boolean;
  protocolSelection: ChatProtocolSelection;
  selectedModel: string;
  modelMissing: boolean;
  chatRuntimeRef: React.MutableRefObject<ChatRuntimeSnapshot>;
  onRuntimeReconciled?: (runtime: ChatRuntimeSnapshot) => void;
  visionCapabilities: Record<AIProvider, VisionCapability>;
  currentVisionCapability: VisionCapability;
  currentConversation: Conversation | null;
  setCurrentConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  setConversations: React.Dispatch<React.SetStateAction<ConversationMeta[]>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setTotalTokens: React.Dispatch<React.SetStateAction<number>>;
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  clearAttachedImages: () => void;
  setCurrentAssistantMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  executedToolCallIdsRef: React.MutableRefObject<Set<string>>;
  toolGuardBlockedRef: React.MutableRefObject<boolean>;
  toolGuardRef: React.MutableRefObject<ToolGuard | null>;
  ownedStreamMessageIdsRef: React.MutableRefObject<Set<string>>;
  isMountedRef: React.MutableRefObject<boolean>;
  chatRulesInjectedRef: React.MutableRefObject<boolean>;
  chatModeRef: React.MutableRefObject<'plan' | 'always-allow'>;
  projectPathRef: React.MutableRefObject<string>;
  messagesRef: React.MutableRefObject<Message[]>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  stickToBottom: () => void;
  autoSaveTimeoutRef: React.MutableRefObject<number | null>;
  saveCurrentConversation: () => Promise<void>;
  acceptAllPendingChanges: () => void;
  pendingChangesRef: React.MutableRefObject<import('./types').PendingFileChange[]>;
  setPendingChanges: React.Dispatch<React.SetStateAction<import('./types').PendingFileChange[]>>;
  autoGenerateConversationTitle: (
    id: string,
    provider: AIProvider,
    model: string,
    text: string,
    names: string[],
  ) => Promise<void>;
  getProviderToolsForChat: (provider: AIProvider) => unknown[] | undefined;
  getAppDataPath: () => Promise<string | null>;
  chatRules: { content: string }[];
  /** Stop active stream/tools before editing/resending a past user message. */
  stopStreaming?: () => Promise<void>;
  onFilesChanged?: (paths: string[]) => void;
  t: {
    errors: { selectModelFirst: string };
    agent: { autoRoutingNotConfigured: string; changeReview: { restoreFailed: string } };
    chat: { fileContext: string; newConversation: string };
  };
}

export function useSendMessage(opts: UseSendMessageOptions) {
  const { showInfo, showWarning } = useNotification();
  const t = useTranslation();

  /**
   * Edit a past user bubble and resend: restore files mutated after that turn,
   * drop subsequent assistant/tool messages, then stream a fresh reply.
   */
  const resendFromUserMessage = async (userMessageId: string, newBodyText: string) => {
    const body = newBodyText.trim();
    if (!body || !opts.currentConversation) {
      return;
    }

    if (opts.isLoading && opts.stopStreaming) {
      try {
        await opts.stopStreaming();
      } catch {
        // best effort stop
      }
    }

    const conversation = opts.currentConversation;
    const allMessages = opts.messagesRef.current;
    const msgIndex = allMessages.findIndex((m) => m.id === userMessageId);
    if (msgIndex < 0) return;
    const original = allMessages[msgIndex];
    if (original.role !== 'user') return;

    const projectPath = opts.projectPathRef.current?.trim() || '';
    const sessionKey = buildChatCheckpointSessionKey(projectPath, conversation.id);

    // Roll back workspace mutations from this user turn onward
    if (projectPath) {
      const store = useCheckpointStore.getState();
      await store.hydrateSession(sessionKey);
      const checkpoints = store.bySession[sessionKey] ?? [];
      const userTurnIds = collectUserMessageIdsFromIndex(allMessages, msgIndex);
      const target = findEarliestCheckpointForUserTurns(
        checkpoints,
        userTurnIds,
        original.timestamp
      );
      if (target) {
        const result = await store.restoreToCheckpoint({
          sessionKey,
          checkpointId: target.id,
          projectPath,
        });
        if (result?.success) {
          const touched = [...(result.restoredFiles ?? []), ...(result.deletedFiles ?? [])];
          if (touched.length > 0) opts.onFilesChanged?.(touched);
        } else if (result && !result.success) {
          showWarning(
            t.agent.changeReview.restoreFailed.replace('{error}', result.message || 'unknown')
          );
        }
      }
    }

    // Pending-change first-before snapshots are invalid after time travel
    opts.setPendingChanges([]);

    const { prefix } = splitChatUserMessageContent(original.content, opts.t.chat.fileContext);
    const nextContent = rebuildChatUserMessageContent(prefix, body);
    const nextTimestamp = Date.now();

    const updatedUserMessage: Message = {
      ...original,
      content: nextContent,
      tokens: estimateMessageTokens(
        toChatPanelProviderRequestMessages([
          {
            id: 'token-estimate',
            role: 'user',
            content: nextContent,
            attachments: original.attachments,
            timestamp: nextTimestamp,
          },
        ])[0]
      ),
      timestamp: nextTimestamp,
    };

    const keptMessages = allMessages
      .slice(0, msgIndex + 1)
      .map((m, i) => (i === msgIndex ? updatedUserMessage : m))
      .filter((m) => !(m.isStreaming && m.role === 'assistant'));

    if (opts.modelMissing) {
      opts.setError(opts.t.errors.selectModelFirst);
      return;
    }

    let provider: AIProvider =
      opts.protocolSelection === 'auto'
        ? opts.chatRuntimeRef.current.provider
        : opts.protocolSelection;
    let runtimeModel = opts.selectedModel;
    let profileId = opts.chatRuntimeRef.current.profileId;

    try {
      const configStr = await invoke<string>('load_ai_config');
      if (configStr) {
        const config = JSON.parse(configStr);
        const reconciled = reconcileChatRequestRuntime(
          config,
          opts.protocolSelection,
          opts.selectedModel,
          opts.chatRuntimeRef.current
        );
        if (!reconciled) {
          opts.setError(opts.t.agent.autoRoutingNotConfigured);
          return;
        }
        provider = reconciled.provider;
        runtimeModel = reconciled.model;
        profileId = reconciled.profileId;
      }
    } catch {
      // keep resolved runtime
    }

    if (opts.protocolSelection === 'auto' && !runtimeModel) {
      opts.setError(opts.t.agent.autoRoutingNotConfigured);
      return;
    }
    if (opts.protocolSelection !== 'auto' && !runtimeModel) {
      opts.setError(opts.t.errors.selectModelFirst);
      return;
    }

    syncChatRuntimeIfChanged(
      opts.chatRuntimeRef,
      {
        provider,
        model: runtimeModel,
        profileId,
        routingMode: opts.protocolSelection === 'auto' ? 'auto' : 'manual',
      },
      opts.onRuntimeReconciled,
      { skipUiSync: opts.protocolSelection === 'auto' }
    );

    opts.executedToolCallIdsRef.current.clear();
    opts.toolGuardBlockedRef.current = false;
    if (!opts.toolGuardRef.current) {
      opts.toolGuardRef.current = new ToolGuard();
    } else {
      opts.toolGuardRef.current.reset();
    }

    opts.setError(null);
    opts.setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    opts.ownedStreamMessageIdsRef.current.add(assistantMessageId);
    opts.setCurrentAssistantMessageId(assistantMessageId);
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true,
      startTime: Date.now(),
    };

    const messagesForState = [...keptMessages, assistantMessage];
    opts.setMessages(messagesForState);
    opts.stickToBottom();

    try {
      const tools = opts.getProviderToolsForChat(provider);
      const previousMessages = messagesForState.filter((message) => !message.isStreaming);
      const rulesAlreadyInjected = opts.chatRulesInjectedRef.current;
      const {
        preparedMessages,
        compressed,
        messages: compactedMessages,
        compactState,
      } = await buildChatContextUsage({
        messages: previousMessages,
        provider,
        model: runtimeModel,
        profileId,
        tools,
        projectPath: opts.projectPathRef.current,
        chatMode: opts.chatModeRef.current,
        chatRules: opts.chatRules,
        chatRulesInjected: rulesAlreadyInjected,
        compactState: conversation.compactState,
      });

      if (compressed) {
        showInfo(t.chat.contextCompressionHint);
        const streamingTail = messagesForState.filter((m) => m.isStreaming);
        opts.setMessages([...compactedMessages, ...streamingTail]);
        const updatedConv = buildConversationPayload(
          conversation,
          compactedMessages,
          compactState
        );
        opts.setCurrentConversation(updatedConv);
        await invoke('save_conversation', { conversation: updatedConv });
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: assistantMessageId,
        model: runtimeModel,
        profileId,
        enableAutoRouting: opts.protocolSelection === 'auto',
        messages: sanitizeMessagesForIpc(preparedMessages),
        tools: sanitizeMessagesForIpc(tools),
        toolChainConfig: {
          enableBackendOrchestration: true,
          maxRounds: 10,
          projectPath: opts.projectPathRef.current,
          appDataPath: (await opts.getAppDataPath()) ?? undefined,
        },
      });

      if (!rulesAlreadyInjected && opts.chatRules.length > 0) {
        opts.chatRulesInjectedRef.current = true;
      }
    } catch (error) {
      opts.ownedStreamMessageIdsRef.current.delete(assistantMessageId);
      opts.setError(`发送失败: ${error}`);
      console.error('AI 聊天重发失败:', error);
      opts.setIsLoading(false);
      opts.setMessages((prev) => prev.filter((message) => message.id !== assistantMessageId));
    }
  };

  const handleSendMessage = async () => {
    if (
      (!opts.inputValue.trim() &&
        opts.attachedFiles.length === 0 &&
        opts.attachedImages.length === 0) ||
      opts.isLoading
    ) {
      return;
    }

    if (opts.modelMissing) {
      opts.setError(opts.t.errors.selectModelFirst);
      return;
    }

    if (opts.pendingChangesRef.current.length > 0) {
      opts.acceptAllPendingChanges();
    }

    let provider: AIProvider =
      opts.protocolSelection === 'auto'
        ? opts.chatRuntimeRef.current.provider
        : opts.protocolSelection;
    let runtimeModel = opts.selectedModel;
    let profileId = opts.chatRuntimeRef.current.profileId;

    try {
      const configStr = await invoke<string>('load_ai_config');
      if (configStr) {
        const config = JSON.parse(configStr);
        const reconciled = reconcileChatRequestRuntime(
          config,
          opts.protocolSelection,
          opts.selectedModel,
          opts.chatRuntimeRef.current
        );
        if (!reconciled) {
          opts.setError(opts.t.agent.autoRoutingNotConfigured);
          return;
        }
        provider = reconciled.provider;
        runtimeModel = reconciled.model;
        profileId = reconciled.profileId;
      }
    } catch {
      // keep resolved runtime when config cannot be loaded
    }

    if (opts.protocolSelection === 'auto' && !runtimeModel) {
      opts.setError(opts.t.agent.autoRoutingNotConfigured);
      return;
    }

    if (opts.protocolSelection !== 'auto' && !runtimeModel) {
      opts.setError(opts.t.errors.selectModelFirst);
      return;
    }

    syncChatRuntimeIfChanged(
      opts.chatRuntimeRef,
      {
        provider,
        model: runtimeModel,
        profileId,
        routingMode: opts.protocolSelection === 'auto' ? 'auto' : 'manual',
      },
      opts.onRuntimeReconciled,
      { skipUiSync: opts.protocolSelection === 'auto' }
    );

    const capability =
      opts.visionCapabilities[provider] || opts.currentVisionCapability;

    if (opts.attachedImages.length > 0 && !capability.supportsVision) {
      opts.setError(VISION_UNSUPPORTED_ERROR);
      return;
    }

    if (opts.attachedImages.length > capability.visionMaxImages) {
      opts.setError(
        `当前模型最多支持 ${opts.currentVisionCapability.visionMaxImages} 张图片`,
      );
      return;
    }

    const userTextForTitle = opts.inputValue;
    const fileNamesForTitle = [
      ...opts.attachedFiles.map((file) => file.name),
      ...opts.attachedImages.map(
        (image) => image.fileName || image.path.split(/[/\\]/).pop() || '图片',
      ),
    ];

    opts.executedToolCallIdsRef.current.clear();
    opts.toolGuardBlockedRef.current = false;
    if (!opts.toolGuardRef.current) {
      opts.toolGuardRef.current = new ToolGuard();
    } else {
      opts.toolGuardRef.current.reset();
    }

    if (!opts.currentConversation) {
      try {
        const conversation = await invoke<Conversation>('create_conversation', {
          title: opts.t.chat.newConversation,
          provider,
          model: runtimeModel,
        });
        opts.setCurrentConversation(conversation);

        const conversations = await invoke<ConversationMeta[]>('list_conversations');
        opts.setConversations(conversations);

        void opts.autoGenerateConversationTitle(
          conversation.id,
          conversation.provider as AIProvider,
          conversation.model,
          userTextForTitle,
          fileNamesForTitle,
        );
      } catch (error) {
        opts.setError(`创建对话失败: ${error}`);
        console.error('创建对话失败:', error);
        return;
      }
    }

    let messageContent = '';

    if (opts.attachedFiles.length > 0) {
      messageContent += opts.t.chat.fileContext;

      for (const file of opts.attachedFiles) {
        messageContent += `- ${file.name} (\`${file.path}\`)\n`;
      }

      messageContent += '---\n\n';
    }

    if (opts.inputValue.trim()) {
      messageContent += opts.inputValue.trim();
    }

    const userAttachments = opts.attachedImages.map(({ previewUrl: _, ...attachment }) => attachment);
    const userTimestamp = Date.now();
    const userMessage: Message = {
      id: userTimestamp.toString(),
      role: 'user',
      content: messageContent,
      attachments: userAttachments,
      tokens: estimateMessageTokens(
        toChatPanelProviderRequestMessages([
          {
            id: 'token-estimate',
            role: 'user',
            content: messageContent,
            attachments: userAttachments,
            timestamp: userTimestamp,
          },
        ])[0],
      ),
      timestamp: userTimestamp,
    };

    opts.setMessages((prev) => [...prev, userMessage]);
    opts.setInputValue('');
    opts.setAttachedFiles([]);
    opts.clearAttachedImages();
    opts.setIsLoading(true);
    opts.setError(null);
    if (opts.textareaRef.current) {
      opts.textareaRef.current.style.height = 'auto';
    }

    const assistantMessageId = (Date.now() + 1).toString();
    opts.ownedStreamMessageIdsRef.current.add(assistantMessageId);
    opts.setCurrentAssistantMessageId(assistantMessageId);
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true,
      startTime: Date.now(),
    };

    opts.setMessages((prev) => [...prev, assistantMessage]);

    opts.stickToBottom();

    try {
      const tools = opts.getProviderToolsForChat(provider);
      logDebug(
        '发送消息，工具启用: ' + String(!!tools) + ' 工具数量: ' + String(tools?.length),
        'ChatPanel',
      );

      const previousMessages = opts.messages.filter((message) => !message.isStreaming);
      const currentMessages = previousMessages.concat(userMessage);
      const rulesAlreadyInjected = opts.chatRulesInjectedRef.current;
      const {
        preparedMessages,
        compressed,
        messages: compactedMessages,
        compactState,
      } = await buildChatContextUsage({
        messages: currentMessages,
        provider,
        model: runtimeModel,
        profileId,
        tools,
        projectPath: opts.projectPathRef.current,
        chatMode: opts.chatModeRef.current,
        chatRules: opts.chatRules,
        chatRulesInjected: rulesAlreadyInjected,
        compactState: opts.currentConversation?.compactState,
      });

      if (compressed) {
        showInfo(t.chat.contextCompressionHint);
        const streamingTail = opts.messages.filter((m) => m.isStreaming);
        opts.setMessages([...compactedMessages, ...streamingTail]);
        if (opts.currentConversation) {
          const updatedConv = buildConversationPayload(
            opts.currentConversation,
            compactedMessages,
            compactState,
          );
          opts.setCurrentConversation(updatedConv);
          await invoke('save_conversation', { conversation: updatedConv });
        }
      }

      await invoke('send_ai_chat_stream', {
        provider,
        messageId: assistantMessageId,
        model: runtimeModel,
        profileId,
        enableAutoRouting: opts.protocolSelection === 'auto',
        messages: sanitizeMessagesForIpc(preparedMessages),
        tools: sanitizeMessagesForIpc(tools),
        toolChainConfig: {
          enableBackendOrchestration: true,
          maxRounds: 10,
          projectPath: opts.projectPathRef.current,
          appDataPath: (await opts.getAppDataPath()) ?? undefined,
        },
      });

      if (!rulesAlreadyInjected && opts.chatRules.length > 0) {
        opts.chatRulesInjectedRef.current = true;
      }
    } catch (error) {
      opts.ownedStreamMessageIdsRef.current.delete(assistantMessageId);
      opts.setError(`发送失败: ${error}`);
      console.error('AI 聊天失败:', error);
      opts.setIsLoading(false);
      opts.setMessages((prev) => prev.filter((message) => message.id !== assistantMessageId));
    }
  };

  return { handleSendMessage, resendFromUserMessage };
}
