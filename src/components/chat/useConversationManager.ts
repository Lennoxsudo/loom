import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logDebug } from '../../utils/errorHandling';
import { normalizeGeneratedTitle } from '../agent/utils';
import type { AIProvider } from '../../utils/visionCapabilities';
import type { Message, Conversation, ConversationMeta, PendingFileChange, ChatProtocolSelection } from './types';
import { buildConversationPayload } from './conversationPersist';
import type { ChatRuntimeSnapshot } from './chatRoutingRuntime';
import { CHAT_LAST_CONVERSATION_STORAGE_KEY } from '../../types/chat';

export interface UseConversationManagerOptions {
  isLoading: boolean;
  isStopping: boolean;
  isExecutingToolsRef: React.MutableRefObject<boolean>;
  currentAssistantMessageId: string | null;
  setCurrentAssistantMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsStopping: React.Dispatch<React.SetStateAction<boolean>>;
  isMountedRef: React.MutableRefObject<boolean>;
  messagesRef: React.MutableRefObject<Message[]>;
  currentConversationRef: React.MutableRefObject<Conversation | null>;
  canceledMessageIdsRef: React.MutableRefObject<Set<string>>;
  toolAbortControllerRef: React.MutableRefObject<AbortController | null>;
  chatRulesInjectedRef: React.MutableRefObject<boolean>;
  autoTitleRequestedRef: React.MutableRefObject<Set<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setTotalTokens: React.Dispatch<React.SetStateAction<number>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setProtocolSelection: React.Dispatch<React.SetStateAction<ChatProtocolSelection>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  chatRuntimeRef: React.MutableRefObject<ChatRuntimeSnapshot>;
  setAttachedFiles: React.Dispatch<React.SetStateAction<import('./types').AttachedFile[]>>;
  clearAttachedImages: () => void;
  setAttachedImages: React.Dispatch<React.SetStateAction<import('./types').PendingImageAttachment[]>>;
  pendingChangesRef: React.MutableRefObject<PendingFileChange[]>;
  setPendingChanges: React.Dispatch<React.SetStateAction<PendingFileChange[]>>;
}

export function useConversationManager({
  isLoading,
  isStopping,
  isExecutingToolsRef,
  currentAssistantMessageId,
  setCurrentAssistantMessageId,
  setIsLoading,
  setIsStopping,
  isMountedRef,
  messagesRef,
  currentConversationRef,
  canceledMessageIdsRef,
  toolAbortControllerRef,
  chatRulesInjectedRef,
  autoTitleRequestedRef,
  setMessages,
  setTotalTokens,
  setError,
  setProtocolSelection,
  setSelectedModel,
  chatRuntimeRef,
  setAttachedFiles,
  clearAttachedImages,
  setAttachedImages,
  pendingChangesRef,
  setPendingChanges,
}: UseConversationManagerOptions) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isConversationDropdownOpen, setIsConversationDropdownOpen] = useState(false);
  const conversationDropdownRef = useRef<HTMLDivElement>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<null | ConversationMeta>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);

  const loadConversation = async (filename: string) => {
    if (isLoading || isStopping || isExecutingToolsRef.current) {
      setError('当前对话进行中，暂时不能切换对话');
      return;
    }
    logDebug('加载对话: 开始加载 ' + filename, 'ChatPanel');

    if (currentAssistantMessageId) {
      logDebug('加载对话: 停止正在进行的AI对话', 'ChatPanel');
      try {
        canceledMessageIdsRef.current.add(currentAssistantMessageId);
        await invoke('cancel_ai_chat', { messageId: currentAssistantMessageId });
      } catch (error) {
        console.error('加载对话: 停止AI对话失败', error);
      }
    }

    if (toolAbortControllerRef.current) {
      logDebug('加载对话: 中止工具执行', 'ChatPanel');
      toolAbortControllerRef.current.abort();
      toolAbortControllerRef.current = null;
    }

    setIsLoading(false);
    setIsStopping(false);
    isExecutingToolsRef.current = false;
    setCurrentAssistantMessageId(null);
    setAttachedFiles([]);
    clearAttachedImages();
    setError(null);
    chatRulesInjectedRef.current = false;

    try {
      const conv = await invoke<Conversation>('load_conversation', { filename });

      if (!isMountedRef.current) {
        return;
      }

      try {
        localStorage.setItem(CHAT_LAST_CONVERSATION_STORAGE_KEY, conv.filename);
      } catch {
        // ignore persist failures
      }

      setCurrentConversation(conv);
      setPendingChanges(conv.pendingChanges ?? []);

      const loadedMessages: Message[] = conv.messages.map((m, idx) => ({
        id: m.id ?? `${Date.now()}-${idx}`,
        role: m.role as Message['role'],
        content: m.content,
        attachments: m.attachments,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
        tool_name: m.tool_name,
        tool_args: m.tool_args,
        thinking: m.thinking,
        tokens: m.tokens ? m.tokens.input + m.tokens.output : undefined,
        timestamp: new Date(m.timestamp).getTime(),
        startTime: m.startTime,
        firstChunkTime: m.firstChunkTime,
        firstContentTime: m.firstContentTime,
        endTime: m.endTime,
        thinkingStartedAt: m.thinkingStartedAt,
        thinkingEndedAt: m.thinkingEndedAt,
        compactBoundary: m.compactBoundary,
        compactSummary: m.compactSummary,
        compactMetadata: m.compactMetadata,
        isStreaming: false,
      }));

      setMessages(loadedMessages);
      setProtocolSelection(conv.provider as ChatProtocolSelection);
      setSelectedModel(conv.model);
      chatRuntimeRef.current = {
        provider: conv.provider as AIProvider,
        model: conv.model,
        routingMode: 'manual',
      };

      const total = loadedMessages.reduce((sum, m) => sum + (m.tokens || 0), 0);
      setTotalTokens(total);

      setIsConversationDropdownOpen(false);
      logDebug('加载对话: 完成', 'ChatPanel');
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      setError(`加载对话失败: ${error}`);
      console.error('加载对话失败:', error);
    }
  };

  const saveCurrentConversation = async () => {
    const conv = currentConversationRef.current;
    const msgs = messagesRef.current;

    if (!conv) {
      logDebug('保存对话: 没有当前对话，跳过保存', 'ChatPanel');
      return;
    }

    try {
      logDebug('保存对话: 开始保存 ' + JSON.stringify({
        conversationId: conv.id,
        title: conv.title,
        messageCount: msgs.length,
      }), 'ChatPanel');

      const updatedConv = buildConversationPayload(
        conv,
        msgs,
        conv.compactState,
        pendingChangesRef.current,
      );

      await invoke('save_conversation', { conversation: updatedConv });

      if (!isMountedRef.current) {
        return;
      }
      setCurrentConversation(updatedConv);

      logDebug('保存对话: 保存成功', 'ChatPanel');

      const convs = await invoke<ConversationMeta[]>('list_conversations');

      if (!isMountedRef.current) {
        return;
      }
      setConversations(convs);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      console.error('保存对话失败:', error);
      setError(`保存对话失败: ${error}`);
    }
  };

  const showStoragePath = async () => {
    try {
      const path = await invoke<string>('get_conversations_path');
      setStoragePath(path);
      logDebug('对话存储路径: ' + path, 'ChatPanel');
    } catch (error) {
      setError(`获取存储路径失败: ${error}`);
      console.error('获取存储路径失败:', error);
    }
  };

  const copyStoragePath = () => {
    if (storagePath) {
      navigator.clipboard.writeText(storagePath);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const createNewConversation = useCallback(() => {
    if (isLoading || isStopping || isExecutingToolsRef.current) {
      setError('当前对话进行中，暂时不能切换对话');
      return;
    }

    try {
      localStorage.removeItem(CHAT_LAST_CONVERSATION_STORAGE_KEY);
    } catch {
      // ignore persist failures
    }

    setCurrentConversation(null);
    setMessages([]);
    setPendingChanges([]);
    setAttachedFiles([]);
    setAttachedImages((prev) => {
      prev.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
      });
      return [];
    });
    setTotalTokens(0);
    setError(null);
    setIsConversationDropdownOpen(false);
    chatRulesInjectedRef.current = false;
  }, [isLoading, isStopping, setMessages, setPendingChanges, setAttachedFiles, setAttachedImages, setTotalTokens, setError, setIsConversationDropdownOpen]);

  const handleStartRename = (e?: React.MouseEvent, conv?: ConversationMeta) => {
    e?.stopPropagation();
    const targetConv = conv || currentConversation;
    if (!targetConv) return;

    setRenamingId(targetConv.id);
    setRenameValue(targetConv.title);
    setIsConversationDropdownOpen(true);

    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 50);
  };

  const handleRenameSubmit = async () => {
    if (!renamingId) return;

    const targetConv = conversations.find((c) => c.id === renamingId);
    if (!targetConv) {
      setRenamingId(null);
      return;
    }

    const newTitle = renameValue.trim();
    if (!newTitle || newTitle === targetConv.title) {
      setRenamingId(null);
      return;
    }

    try {
      const updatedConv = await invoke<Conversation>('rename_conversation', {
        oldFilename: targetConv.filename,
        newTitle,
      });

      if (currentConversation && currentConversation.id === renamingId) {
        setCurrentConversation(updatedConv);
      }

      setRenamingId(null);

      const convs = await invoke<ConversationMeta[]>('list_conversations');
      setConversations(convs);
    } catch (error) {
      setError(`重命名失败: ${error}`);
      console.error('重命名对话失败:', error);
      setRenamingId(null);
    }
  };

  const handleCancelRename = () => {
    setRenamingId(null);
  };

  const requestDeleteConversation = (e: React.MouseEvent, conv: ConversationMeta) => {
    e.stopPropagation();
    setPendingDelete(conv);
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDelete || isDeletingConversation) return;

    setIsDeletingConversation(true);
    try {
      await invoke('delete_conversation', { filename: pendingDelete.filename });

      if (currentConversation?.filename === pendingDelete.filename) {
        try {
          localStorage.removeItem(CHAT_LAST_CONVERSATION_STORAGE_KEY);
        } catch {
          // ignore persist failures
        }
        setCurrentConversation(null);
        setMessages([]);
        setPendingChanges([]);
        setTotalTokens(0);
        chatRulesInjectedRef.current = false;
      }

      const convs = await invoke<ConversationMeta[]>('list_conversations');
      setConversations(convs);
      setPendingDelete(null);
    } catch (error) {
      setError(`删除失败: ${error}`);
      console.error('删除对话失败:', error);
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const autoGenerateConversationTitle = async (
    conversationId: string,
    provider: AIProvider,
    model: string,
    userText: string,
    fileNames: string[]
  ) => {
    if (autoTitleRequestedRef.current.has(conversationId)) return;
    autoTitleRequestedRef.current.add(conversationId);

    const trimmedUserText = userText.trim();
    const cleanedFileNames = fileNames.map((n) => n.trim()).filter((n) => n.length > 0);
    const titleContext =
      trimmedUserText ||
      (cleanedFileNames.length > 0
        ? `（无文本，相关文件：${cleanedFileNames.join('、')}）`
        : '（无文本）');

    try {
      const raw = await invoke<string>('generate_conversation_title', {
        provider,
        model,
        userText: titleContext,
        fileNames: cleanedFileNames,
      });

      const newTitle = normalizeGeneratedTitle(raw);
      if (!newTitle) return;

      let latestConversation = currentConversationRef.current;
      if (!latestConversation || latestConversation.id !== conversationId) {
        for (let i = 0; i < 20; i++) {
          if (!isMountedRef.current) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
          latestConversation = currentConversationRef.current;
          if (latestConversation && latestConversation.id === conversationId) break;
        }
      }

      if (!latestConversation || latestConversation.id !== conversationId) return;
      if (latestConversation.title !== '新对话' && latestConversation.messages.length > 2) return;
      
      const updatedConversation: Conversation = {
        ...latestConversation,
        title: newTitle,
      };

      await invoke('save_conversation', { conversation: updatedConversation });

      if (!isMountedRef.current) return;
      currentConversationRef.current = updatedConversation;
      setCurrentConversation(updatedConversation);

      const convs = await invoke<ConversationMeta[]>('list_conversations');
      if (!isMountedRef.current) return;
      setConversations(convs);
    } catch (error) {
      console.error('自动生成对话标题失败:', error);
      autoTitleRequestedRef.current.delete(conversationId);
    }
  };

  return {
    conversations,
    setConversations,
    currentConversation,
    setCurrentConversation,
    isConversationDropdownOpen,
    setIsConversationDropdownOpen,
    conversationDropdownRef,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    renameInputRef,
    storagePath,
    setStoragePath,
    isCopied,
    pendingDelete,
    setPendingDelete,
    isDeletingConversation,
    loadConversation,
    saveCurrentConversation,
    showStoragePath,
    copyStoragePath,
    createNewConversation,
    handleStartRename,
    handleRenameSubmit,
    handleCancelRename,
    requestDeleteConversation,
    confirmDeleteConversation,
    autoGenerateConversationTitle,
  };
}
