import { invoke } from '@tauri-apps/api/core';
import { estimateMessageTokens } from '../../utils/contextBudget';
import { sanitizeMessagesForIpc } from '../../utils/aiTools';
import { toChatPanelProviderRequestMessages, VISION_UNSUPPORTED_ERROR } from './types';
import { buildChatContextUsage } from './contextUsage';
import { buildConversationPayload } from './conversationPersist';
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
  t: {
    errors: { selectModelFirst: string };
    agent: { autoRoutingNotConfigured: string };
    chat: { fileContext: string; newConversation: string };
  };
}

export function useSendMessage(opts: UseSendMessageOptions) {
  const { showInfo } = useNotification();
  const t = useTranslation();

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

  return { handleSendMessage };
}
