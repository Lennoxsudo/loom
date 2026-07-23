import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import {
  AI_TOOLS,
  getAIToolsWithBrowserConfig,
  findBestToolMatch,
  filterToolsByContext,
  toOpenAITools,
  toAnthropicTools,
} from '../features/agent-engine';
import { isToolBlockedInPlanMode } from '../utils/agentTools';
import { isImageFilePath } from '../utils/fileTreeUtils';
import { extractVisionCapabilities } from '../utils/visionCapabilities';
import { useToolStore } from '../stores/useToolStore';
import { useRulesStore } from '../stores/useRulesStore';
import { useUsageStore } from '../stores/useUsageStore';
import { useAgentAccessMode, useStreamSpeed, useEnableCodeGraph, useEnableCdpBrowser } from '../stores';
import { estimateTokens, estimateMessageTokens } from '../utils/contextBudget';
import { useTranslation } from '../i18n';
import { logDebug, isTauriCancellationError } from '../utils/errorHandling';
import {
  isBuiltinProtocol,
  resolveBuiltinStreamError,
} from '../utils/builtinGateway';
import { useBuiltinGatewayStore } from '../stores/useBuiltinGatewayStore';
import styles from './ChatPanel.module.css';
import {
  type VisionCapability,
  type AIProvider,
  DEFAULT_VISION_CAPABILITIES,
} from '../utils/visionCapabilities';
import { ToolGuard } from '../utils/toolGuard';
import { CHAT_LAST_CONVERSATION_STORAGE_KEY, CHAT_MODES_STORAGE_KEY } from '../types/chat';
import {
  type ChatPanelProps,
  type Message,
  type ToolCall,
  type StreamSpeed,
  type ChatProtocolSelection,
  VISION_UNSUPPORTED_ERROR,
  CHAT_NEW_CONVERSATION_EVENT,
} from './chat/types';
import { CHAT_PROTOCOL_STORAGE_KEY, type ChatRuntimeSnapshot } from './chat/chatRoutingRuntime';
import { useChatConfig } from './chat/useChatConfig';
import { useChatAttachments } from './chat/useChatAttachments';
import { useStreamChunkQueue } from './chat/useStreamChunkQueue';
import { StreamCompletionCoordinator } from './chat/streamCompletionCoordinator';
import { useChatStickToBottom } from './chat/useChatStickToBottom';
import { useStopHandler, finalizeStoppedMessage } from './chat/useStopHandler';
import { useToolCalls } from './chat/useToolCalls';
import { useConversationManager } from './chat/useConversationManager';
import { useSendMessage } from './chat/useSendMessage';
import { buildChatContextUsage } from './chat/contextUsage';
import ConversationSelector from './chat/ConversationSelector';
import { ChatHeaderActions } from './chat/ChatHeaderActions';
import { isComposerSelectorMenuTarget } from './chat/useAnchoredPortalMenu';
import ChatModeToggle from './chat/ChatModeToggle';
import ChatMessageList from './chat/ChatMessageList';
import ChatInputArea from './chat/ChatInputArea';
import ProviderModelSelector from './chat/ProviderModelSelector';
import StoragePathModal from './chat/StoragePathModal';
import DeleteConversationModal from './chat/DeleteConversationModal';
import TokenRingIndicator from './chat/TokenRingIndicator';
import { useImageGenConfig } from '../hooks/useImageGenConfig';
import { useCbmGraphReady } from '../stores/useCbmStore';
import { buildGenerateImageTool, isImageGenConfigured } from '../utils/imageGenConfig';
import { usePendingChanges } from './chat/usePendingChanges';
import { useBottomDockLayout } from './chat/useBottomDockLayout';
import { finalizeStreamMessage } from '../utils/streamChunkSeparation';
import type { PendingFileChange } from './chat/types';
import TodoListBar from './agent/TodoListBar';
import PlanDocumentPanel from './agent/PlanDocumentPanel';
import ComposerQuestionAnchor from './agent/ComposerQuestionAnchor';
import type { QuestionInput, UserAnswer } from '../features/agent-engine/toolArgs';
import type { PlanDocument } from '../features/agent-engine/planStore';
import { setPlan } from '../features/agent-engine/planStore';
import { usePlanDocumentVisible } from '../features/agent-engine/usePlanDocumentVisible';
import { PlusIcon } from './shared/Icons';
import { getSkillsList, type SkillEntry } from '../utils/skills';

export default function ChatPanel({ width, projectPath, onFilesChanged }: ChatPanelProps) {
  const t = useTranslation();
  const streamSpeed = useStreamSpeed();
  const agentAccessMode = useAgentAccessMode();
  const enableCdpBrowser = useEnableCdpBrowser();
  const mcpTools = useToolStore((s) => s.mcpTools);
  const chatRules = useRulesStore((s) => s.chatRules);
  const imageGenConfig = useImageGenConfig();
  const allConfiguredTools = useMemo(
    () =>
      getAIToolsWithBrowserConfig([
        ...AI_TOOLS,
        ...(isImageGenConfigured(imageGenConfig) ? [buildGenerateImageTool(imageGenConfig)] : []),
        ...mcpTools,
      ]),
    // Recompute when CDP plugin toggles so browser action enum updates.
    [imageGenConfig, mcpTools, enableCdpBrowser]
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [invocableSkills, setInvocableSkills] = useState<SkillEntry[]>([]);
  const [protocolSelection, setProtocolSelection] = useState<ChatProtocolSelection>(() => {
    try {
      const stored = localStorage.getItem(CHAT_PROTOCOL_STORAGE_KEY);
      if (stored === 'auto') return 'auto';
      if (
        stored === 'openai' ||
        stored === 'anthropic' ||
        stored === 'ollama' ||
        stored === 'builtin'
      ) {
        return stored;
      }
    } catch {
      // ignore persist failures
    }
    return 'anthropic';
  });
  const [selectedModel, setSelectedModel] = useState<string>('');
  const protocolSelectionRef = useRef<ChatProtocolSelection>(protocolSelection);
  protocolSelectionRef.current = protocolSelection;
  const chatRuntimeRef = useRef<ChatRuntimeSnapshot>({
    provider: 'anthropic',
    model: '',
    routingMode: 'manual',
  });
  const isAutoRouting = protocolSelection === 'auto';
  const effectiveProvider: AIProvider = isAutoRouting
    ? chatRuntimeRef.current.provider || 'anthropic'
    : protocolSelection;
  const [chatMode, setChatMode] = useState<'plan' | 'always-allow'>(() => {
    try {
      const stored = localStorage.getItem(CHAT_MODES_STORAGE_KEY);
      if (stored === 'plan' || stored === 'always-allow') {
        return stored;
      }
    } catch {
      // ignore parse errors
    }
    return 'always-allow';
  });
  const chatModeRef = useRef<'plan' | 'always-allow'>(chatMode);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [maxContextTokens, setMaxContextTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingFileChange[]>([]);
  const [isPendingChangesCollapsed, setIsPendingChangesCollapsed] = useState(true);
  const [toolsEnabled] = useState(true);
  const enableCodeGraph = useEnableCodeGraph();
  const cbmGraphEnabled = useCbmGraphReady(enableCodeGraph);
  const [visionCapabilities, setVisionCapabilities] = useState<
    Record<AIProvider, VisionCapability>
  >(DEFAULT_VISION_CAPABILITIES);

  const [currentAssistantMessageId, setCurrentAssistantMessageId] = useState<string | null>(null);
  const currentAssistantMessageIdRef = useRef<string | null>(null);
  const executedToolCallIdsRef = useRef(new Set<string>());
  const isExecutingToolsRef = useRef(false);
  const toolAbortControllerRef = useRef<AbortController | null>(null);
  const toolGuardRef = useRef<ToolGuard | null>(null);
  const toolGuardBlockedRef = useRef(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<import('react-virtuoso').VirtuosoHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputCardRef = useRef<HTMLDivElement>(null);

  const bottomDockRef = useRef<HTMLDivElement>(null);

  const {
    followOutput,
    atBottomThreshold,
    onAtBottomStateChange,
    onTotalListHeightChanged,
    onIsScrolling,
    showScrollButton,
    isUserScrollingRef,
    scrollToBottom,
    stickToBottom,
  } = useChatStickToBottom({ virtuosoRef, scrollerRef });

  const currentConversationRef = useRef<import('./chat/types').Conversation | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const pendingChangesRef = useRef<PendingFileChange[]>([]);
  const canceledMessageIdsRef = useRef<Set<string>>(new Set());
  const ownedStreamMessageIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const hasRestoredConversationRef = useRef(false);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const saveCurrentConversationRef = useRef<(() => Promise<void>) | null>(null);
  const autoTitleRequestedRef = useRef<Set<string>>(new Set());
  const streamSpeedRef = useRef<StreamSpeed>(streamSpeed);

  const onFilesChangedRef = useRef<ChatPanelProps['onFilesChanged']>(onFilesChanged);
  const projectPathRef = useRef<string>(projectPath);
  projectPathRef.current = projectPath;
  const appDataPathRef = useRef<string | null>(null);
  const getAppDataPath = useCallback(async () => {
    if (appDataPathRef.current) return appDataPathRef.current;
    try {
      const path = await invoke<string>('get_app_data_path');
      appDataPathRef.current = path;
      return path;
    } catch {
      return null;
    }
  }, []);

  const chatRulesInjectedRef = useRef(false);

  useEffect(() => {
    currentAssistantMessageIdRef.current = currentAssistantMessageId;
  }, [currentAssistantMessageId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges]);

  useEffect(() => {
    onFilesChangedRef.current = onFilesChanged;
  }, [onFilesChanged]);

  useEffect(() => {
    let cancelled = false;
    getSkillsList(projectPath || '')
      .then(({ global: globalSkills, project: projectSkills }) => {
        if (cancelled) return;
        const projectNameSet = new Set(projectSkills.map((skill) => skill.name));
        const merged = [
          ...globalSkills.filter((skill) => !projectNameSet.has(skill.name)),
          ...projectSkills,
        ].sort((a, b) => a.name.localeCompare(b.name));
        setInvocableSkills(merged.filter((skill) => skill.userInvocable !== false));
      })
      .catch(() => {
        if (!cancelled) setInvocableSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_PROTOCOL_STORAGE_KEY, protocolSelection);
    } catch {
      // ignore persist failures
    }
    chatRuntimeRef.current = {
      ...chatRuntimeRef.current,
      routingMode: protocolSelection === 'auto' ? 'auto' : 'manual',
      ...(protocolSelection !== 'auto' ? { provider: protocolSelection } : {}),
    };
  }, [protocolSelection]);

  const onRuntimeReconciled = useCallback((runtime: ChatRuntimeSnapshot) => {
    setProtocolSelection(runtime.provider);
    setSelectedModel(runtime.model);
  }, []);

  // Hooks
  useChatConfig({
    setVisionCapabilities,
    setProtocolSelection,
    setAvailableModels,
    setSelectedModel,
    getProtocolSelection: () => protocolSelectionRef.current,
  });

  const {
    attachedFiles,
    setAttachedFiles,
    attachedImages,
    setAttachedImages,
    isDragOver,
    isOverChatAttach,
    setChatAttachRef,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleInputPaste,
    removeFileFromContext,
    removeImageFromContext,
    clearAttachedImages,
    addFileToContext,
    addImagePathToContext,
  } = useChatAttachments({
    selectedProvider: effectiveProvider,
    visionCapabilities,
    setError,
    inputCardRef,
  });

  const {
    streamChunkQueueRef,
    streamChunkTimerRef,
    flushAllQueuedChunks,
    flushQueuedChunksForMessage,
    enqueueStreamChunk,
    stopStreamChunkTimer,
  } = useStreamChunkQueue({
    setMessages,
    canceledMessageIdsRef,
    isMountedRef,
    streamSpeedRef,
  });
  const streamCompletionCoordinatorRef = useRef<StreamCompletionCoordinator | null>(null);
  if (!streamCompletionCoordinatorRef.current) {
    streamCompletionCoordinatorRef.current = new StreamCompletionCoordinator(flushQueuedChunksForMessage);
  }

  const [pendingQuestionsByConversation, setPendingQuestionsByConversation] = useState<
    Record<string, QuestionInput[]>
  >({});
  const resolveQuestionsByConversationRef = useRef<
    Record<string, (answers: UserAnswer[]) => void>
  >({});

  const handleCancelPendingQuestions = useCallback(() => {
    const conversationId = currentConversationRef.current?.id;
    if (!conversationId) return;
    setPendingQuestionsByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    const resolve = resolveQuestionsByConversationRef.current[conversationId];
    if (resolve) {
      resolve([]);
      delete resolveQuestionsByConversationRef.current[conversationId];
    }
  }, []);

  const handleUserAnswers = useCallback((conversationId: string, answers: UserAnswer[]) => {
    setPendingQuestionsByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    const resolve = resolveQuestionsByConversationRef.current[conversationId];
    if (resolve) {
      resolve(answers);
      delete resolveQuestionsByConversationRef.current[conversationId];
    }
  }, []);

  const handleSubmitPendingQuestions = useCallback(
    (answers: UserAnswer[]) => {
      const conversationId = currentConversationRef.current?.id;
      if (!conversationId) return;
      handleUserAnswers(conversationId, answers);
    },
    [handleUserAnswers]
  );

  const handleAskUserQuestion = useCallback(
    (conversationId: string, questions: QuestionInput[]) =>
      new Promise<UserAnswer[]>((resolve) => {
        const existingResolve = resolveQuestionsByConversationRef.current[conversationId];
        if (existingResolve) {
          existingResolve([]);
        }

        resolveQuestionsByConversationRef.current[conversationId] = resolve;
        setPendingQuestionsByConversation((prev) => ({
          ...prev,
          [conversationId]: questions,
        }));
      }),
    []
  );

  const [planReviewConversationId, setPlanReviewConversationId] = useState<string | null>(null);
  const handleSendMessageRef = useRef<(() => Promise<void>) | null>(null);

  /** Non-blocking: show plan panel and end the agent turn (handled in tool loop). */
  const handleExitPlanMode = useCallback(
    (req: {
      conversationId: string;
      agentId?: string;
      plan: string;
      title?: string;
    }) => {
      setPlanReviewConversationId(req.conversationId);
      void saveCurrentConversationRef.current?.();
    },
    [],
  );

  /** User accepted the plan — switch to execute and start a new turn. */
  const settleExitPlanReview = useCallback(
    (conversationId: string, planDoc: PlanDocument) => {
      if (planReviewConversationId === conversationId) {
        setPlanReviewConversationId(null);
      }
      setPlan(conversationId, {
        content: planDoc.content,
        title: planDoc.title,
        status: 'accepted',
      });
      chatModeRef.current = 'always-allow';
      setChatMode('always-allow');
      const title = planDoc.title?.trim();
      const continueText = title
        ? `用户已接受计划「${title}」。请立即按批准的计划执行，不要再调用 exit_plan_mode。`
        : '用户已接受计划。请立即按批准的计划执行，不要再调用 exit_plan_mode。';
      setInputValue(continueText);
      window.setTimeout(() => {
        void handleSendMessageRef.current?.();
      }, 80);
    },
    [planReviewConversationId],
  );

  const {
    handleStop,
    stopTimeoutRef,
  } = useStopHandler({
    currentAssistantMessageId,
    setCurrentAssistantMessageId,
    setIsLoading,
    isStopping,
    setIsStopping,
    isExecutingToolsRef,
    toolAbortControllerRef,
    canceledMessageIdsRef,
    ownedStreamMessageIdsRef,
    flushQueuedChunksForMessage,
    cancelStreamCompletion: (messageId) => streamCompletionCoordinatorRef.current?.cancel(messageId),
    setMessages,
    setError,
    autoSaveTimeoutRef,
    saveCurrentConversationRef,
  });

  const {
    handleToolCallsRef,
    approvePendingToolCalls,
    denyPendingToolCalls,
  } = useToolCalls({
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
    onPendingFileChangesDetected: (changes) => {
      setPendingChanges((prev) => {
        const merged = new Map<string, PendingFileChange>();
        for (const change of prev) {
          merged.set(change.filePath.replace(/\\/g, '/').toLowerCase(), change);
        }
        for (const change of changes) {
          const key = change.filePath.replace(/\\/g, '/').toLowerCase();
          const existing = merged.get(key);
          merged.set(key, {
            ...change,
            id: existing?.id ?? change.id,
            existedBefore: existing?.existedBefore ?? change.existedBefore,
            beforeContent:
              existing?.beforeContent !== undefined ? existing.beforeContent : change.beforeContent,
            createdAt: existing?.createdAt ?? change.createdAt,
          });
        }
        return Array.from(merged.values());
      });
    },
    getAppDataPath,
    agentAccessMode,
    onAskUserQuestion: handleAskUserQuestion,
    onExitPlanMode: handleExitPlanMode,
    t,
  });

  const {
    acceptPendingChange,
    rejectPendingChange,
    acceptAllPendingChanges,
  } = usePendingChanges({
    setPendingChanges,
    setError,
    projectPathRef,
    onFilesChangedRef,
    t,
  });

  const getProviderToolsForChat = useCallback(
    (provider: AIProvider) => {
      if (!toolsEnabled) return undefined;
      let tools = filterToolsByContext(allConfiguredTools, {
        isGitRepo: true,
        hasBrowserCapability: true,
        enableCodeGraph: cbmGraphEnabled,
      });
      if (chatMode === 'plan') {
        tools = tools.filter((tool) => !isToolBlockedInPlanMode(tool.name));
      }
      // builtin streams via openai-compatible tools schema
      if (provider === 'anthropic') {
        return toAnthropicTools(tools);
      }
      return toOpenAITools(tools);
    },
    [allConfiguredTools, cbmGraphEnabled, chatMode, toolsEnabled]
  );

  useEffect(() => {
    let cancelled = false;

    const updateContextUsage = async () => {
      const contextModel = isAutoRouting ? chatRuntimeRef.current.model : selectedModel;
      if (!contextModel.trim()) {
        if (!cancelled) {
          setTotalTokens(0);
          setMaxContextTokens(0);
        }
        return;
      }

      try {
        const tools = getProviderToolsForChat(effectiveProvider);
        const stableMessages = messages.filter((message) => !message.isStreaming);
        const usage = await buildChatContextUsage({
          messages: stableMessages,
          provider: effectiveProvider,
          model: contextModel,
          tools,
          projectPath: projectPathRef.current,
          chatMode,
          chatRules,
          chatRulesInjected: chatRulesInjectedRef.current,
          conversationId: currentConversationRef.current?.id,
        });

        if (!cancelled) {
          setTotalTokens(usage.usedTokens);
          setMaxContextTokens(usage.availableContextTokens);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to recalculate chat context usage:', error);
          setTotalTokens(0);
          setMaxContextTokens(0);
        }
      }
    };

    void updateContextUsage();

    return () => {
      cancelled = true;
    };
  }, [chatMode, chatRules, effectiveProvider, getProviderToolsForChat, isAutoRouting, messages, projectPath, selectedModel]);

  const {
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
  } = useConversationManager({
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
  });

  const { overlayInset: bottomOverlayInset, resizeKey: bottomDockRevision, handleOverlayChange } =
    useBottomDockLayout(bottomDockRef, currentConversation?.id);

  useEffect(() => {
    currentConversationRef.current = currentConversation;
  }, [currentConversation]);

  useEffect(() => {
    try {
      if (currentConversation?.filename) {
        localStorage.setItem(CHAT_LAST_CONVERSATION_STORAGE_KEY, currentConversation.filename);
      }
    } catch {
      // ignore persist failures
    }
  }, [currentConversation?.filename]);

  useEffect(() => {
    setIsPendingChangesCollapsed(true);
  }, [currentConversation?.id]);

  useEffect(() => {
    if (!currentConversation) {
      return;
    }

    if (autoSaveTimeoutRef.current != null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      if (!isMountedRef.current) return;
      void saveCurrentConversationRef.current?.();
    }, 300);
  }, [currentConversation?.id, pendingChanges]);

  // Persist live turns (assistant + tools) so closing during exit_plan_mode / tool
  // wait does not lose history. Debounced to avoid thrashing disk mid-stream.
  useEffect(() => {
    if (!currentConversation?.id || messages.length === 0) return;
    if (autoSaveTimeoutRef.current != null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      if (!isMountedRef.current) return;
      void saveCurrentConversationRef.current?.();
    }, 800);
  }, [messages, currentConversation?.id]);

  // Flush conversation on app close / tab hide (best-effort).
  useEffect(() => {
    const flush = () => {
      void saveCurrentConversationRef.current?.();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const { handleSendMessage, resendFromUserMessage } = useSendMessage({
    inputValue,
    setInputValue,
    attachedFiles,
    attachedImages,
    isLoading,
    protocolSelection,
    selectedModel,
    modelMissing: !isAutoRouting && !selectedModel.trim(),
    chatRuntimeRef,
    onRuntimeReconciled,
    visionCapabilities,
    currentVisionCapability:
      visionCapabilities[effectiveProvider] || DEFAULT_VISION_CAPABILITIES[effectiveProvider],
    currentConversation,
    setCurrentConversation,
    setConversations,
    messages,
    setMessages,
    setIsLoading,
    setError,
    setTotalTokens,
    setAttachedFiles,
    clearAttachedImages,
    setCurrentAssistantMessageId,
    executedToolCallIdsRef,
    toolGuardBlockedRef,
    toolGuardRef,
    ownedStreamMessageIdsRef,
    isMountedRef,
    chatRulesInjectedRef,
    chatModeRef,
    projectPathRef,
    messagesRef,
    textareaRef,
    stickToBottom,
    autoSaveTimeoutRef,
    saveCurrentConversation,
    acceptAllPendingChanges,
    pendingChangesRef,
    setPendingChanges,
    autoGenerateConversationTitle,
    getProviderToolsForChat,
    getAppDataPath,
    chatRules,
    stopStreaming: handleStop,
    onFilesChanged: (paths) => onFilesChangedRef.current?.(paths),
    t,
  });

  const handleResendFromUserMessage = useCallback(
    async (messageId: string, newText: string) => {
      await resendFromUserMessage(messageId, newText);
    },
    [resendFromUserMessage]
  );

  saveCurrentConversationRef.current = saveCurrentConversation;
  handleSendMessageRef.current = handleSendMessage;

  // Dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamSpeedRef.current = streamSpeed;

    if (streamSpeed === 'fast') {
      flushAllQueuedChunks();
      return;
    }

    if (streamChunkTimerRef.current != null) {
      stopStreamChunkTimer();
    }
    if (streamChunkQueueRef.current.length > 0) {
      // Timer already managed by ensureStreamChunkTimer
    }
  }, [streamSpeed, flushAllQueuedChunks, stopStreamChunkTimer, streamChunkTimerRef, streamChunkQueueRef]);

  useEffect(() => {
    chatModeRef.current = chatMode;
    try {
      localStorage.setItem(CHAT_MODES_STORAGE_KEY, chatMode);
    } catch {
      // ignore persist failures
    }
  }, [chatMode]);

  useEffect(() => {
    if (protocolSelection === 'auto') return;

    const loadModels = async () => {
      if (protocolSelection === 'builtin') {
        try {
          const { useBuiltinGatewayStore } = await import('../stores/useBuiltinGatewayStore');
          const store = useBuiltinGatewayStore.getState();
          if (!store.hydrated) await store.hydrate();
          if (!store.isActivated()) {
            setAvailableModels([]);
            setSelectedModel('');
            setError(t.settingsBuiltin.notActivated);
            return;
          }
          setError(null);
          let models = store.models;
          if (models.length === 0) {
            models = await store.refreshModels();
          }
          if (models.length === 0) {
            const configStr = await invoke<string>('load_ai_config');
            if (configStr) {
              const config = JSON.parse(configStr) as {
                profiles?: {
                  openai?: { items?: Array<{ id?: string; models?: string[] }> };
                };
              };
              const item = config.profiles?.openai?.items?.find(
                (it) => it.id === 'builtin-gateway'
              );
              models = (item?.models ?? []).map((m) => m.trim()).filter(Boolean);
            }
          }
          setAvailableModels(models);
          setSelectedModel((prev) =>
            prev && models.includes(prev) ? prev : models[0] || ''
          );
        } catch (error) {
          console.error('加载内置模型列表失败:', error);
        }
        return;
      }

      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          setVisionCapabilities(extractVisionCapabilities(config));
          const providerConfig = config.configs?.[protocolSelection];
          if (providerConfig) {
            const models =
              providerConfig.models || (providerConfig.model ? [providerConfig.model] : []);
            setAvailableModels(models);
            setSelectedModel(models[0] || '');
          } else {
            setAvailableModels([]);
            setSelectedModel('');
          }
        }
      } catch (error) {
        console.error('加载模型列表失败:', error);
      }
    };
    loadModels();
  }, [protocolSelection, t.settingsBuiltin.notActivated]);

  useEffect(() => {
    const loadConversations = async () => {
      if (!isTauri()) return;
      try {
        const convs = await invoke<import('./chat/types').ConversationMeta[]>('list_conversations');
        setConversations(convs);
      } catch (error) {
        console.error('加载对话列表失败:', error);
      }
    };
    loadConversations();
  }, []);

  useEffect(() => {
    if (hasRestoredConversationRef.current) return;
    if (currentConversation || conversations.length === 0) return;

    let storedFilename: string | null = null;
    try {
      storedFilename = localStorage.getItem(CHAT_LAST_CONVERSATION_STORAGE_KEY);
    } catch {
      storedFilename = null;
    }

    hasRestoredConversationRef.current = true;

    if (!storedFilename) return;
    const matched = conversations.find((conv) => conv.filename === storedFilename);
    if (!matched) {
      try {
        localStorage.removeItem(CHAT_LAST_CONVERSATION_STORAGE_KEY);
      } catch {
        // ignore persist failures
      }
      return;
    }

    void loadConversation(matched.filename);
  }, [conversations, currentConversation, loadConversation]);

  useEffect(() => {
    const cleanup = async () => {
      if (!isTauri()) return;
      try {
        await invoke<number>('cleanup_old_conversations');
        await invoke<number>('cleanup_orphan_chat_images');
      } catch (error) {
        console.error('清理旧对话失败:', error);
      }
    };
    cleanup();
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const canceledIds = canceledMessageIdsRef.current;

    return () => {
      logDebug('组件卸载: 开始清理', 'ChatPanel');

      isMountedRef.current = false;
      if (autoSaveTimeoutRef.current != null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      if (stopTimeoutRef.current != null) {
        window.clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }
      if (streamChunkTimerRef.current != null) {
        window.clearInterval(streamChunkTimerRef.current);
        streamChunkTimerRef.current = null;
      }
      streamChunkQueueRef.current = [];
      streamCompletionCoordinatorRef.current?.dispose();

      const activeMessageId = currentAssistantMessageIdRef.current;
      if (activeMessageId) {
        canceledIds.add(activeMessageId);
        logDebug('组件卸载: 取消AI对话 ' + activeMessageId, 'ChatPanel');
        invoke('cancel_ai_chat', { messageId: activeMessageId }).catch((err) => {
          console.error('组件卸载: 取消AI对话失败', err);
        });
      }

      if (toolAbortControllerRef.current) {
        logDebug('组件卸载: 中止工具执行', 'ChatPanel');
        toolAbortControllerRef.current.abort();
      }

      logDebug('组件卸载: 清理完成', 'ChatPanel');
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      if (isComposerSelectorMenuTarget(target)) {
        return;
      }
      if (dropdownRef.current && !dropdownRef.current.contains(target as Node)) {
        setIsDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(target as Node)) {
        setIsModelDropdownOpen(false);
      }
      if (
        conversationDropdownRef.current &&
        !conversationDropdownRef.current.contains(event.target as Node)
      ) {
        setIsConversationDropdownOpen(false);
        if (renamingId) {
          setRenamingId(null);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [renamingId]);

  useEffect(() => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      const maxHeight = 120;
      el.style.height = 'auto';
      const nextHeight = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [inputValue]);

  useEffect(() => {
    const unlisten = listen<{ message_id: string; chunk: string; chunk_type: string }>(
      'ai-stream-chunk',
      (event) => {
        const { message_id, chunk, chunk_type } = event.payload;

        if (!isMountedRef.current) return;
        if (!ownedStreamMessageIdsRef.current.has(message_id)) return;
        if (canceledMessageIdsRef.current.has(message_id)) return;

        streamCompletionCoordinatorRef.current?.noteChunk(message_id);
        enqueueStreamChunk({
          message_id,
          chunk,
          chunk_type,
          chunkTime: Date.now(),
        });
      }
    );

    const unlistenComplete = listen<{
      message_id: string;
      tool_calls?: ToolCall[];
      provider?: string;
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    }>(
      'ai-stream-complete',
      (event) => {
        const { message_id, tool_calls, usage, provider, model } = event.payload;

        if (!ownedStreamMessageIdsRef.current.has(message_id)) {
          return;
        }

        // 用量/成本追踪：Chat 页面只记录 token 数，不计算费用（费用不明确）
        if (usage) {
          useUsageStore.getState().addUsage({
            sessionKey: currentConversationRef.current?.id,
            provider,
            model,
            input: usage.input_tokens,
            output: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens,
            cacheWrite: usage.cache_creation_input_tokens,
            skipCost: true,
          });
        }

        let pseudoToolCalls: ToolCall[] = [];
        let finalToolCalls: ToolCall[] | undefined;

        const extractPseudoToolCalls = (content: string): ToolCall[] => {
          const result: ToolCall[] = [];
          const toolNames = new Set(allConfiguredTools.map((t) => t.name));
          const regex = /\[Tool:\s*([a-zA-Z0-9_]+)(?:\s*\(([^)]*)\))?\]\s*\n?/g;
          let match: RegExpExecArray | null;

          while ((match = regex.exec(content)) != null) {
            let name = match[1];
            const idHint = (match[2] || '').trim();
            if (!toolNames.has(name)) {
              const bestMatch = findBestToolMatch(name, Array.from(toolNames));
              if (bestMatch) {
                name = bestMatch;
              } else {
                continue;
              }
            }

            const startIndex = regex.lastIndex;
            const nextMatch = regex.exec(content);
            const endIndex = nextMatch ? nextMatch.index : content.length;

            const slice = content.slice(startIndex, endIndex).trim();
            let args: unknown = {};
            if (slice) {
              const firstBrace = slice.indexOf('{');
              const lastBrace = slice.lastIndexOf('}');
              const jsonCandidate =
                firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
                  ? slice.slice(firstBrace, lastBrace + 1)
                  : slice;
              try {
                args = JSON.parse(jsonCandidate);
              } catch {
                args = {};
              }
            }

            const id =
              idHint && !idHint.includes(' ')
                ? idHint
                : `pseudo-${name}-${Date.now()}-${result.length}`;
            result.push({
              id,
              type: 'function',
              function: {
                name,
                arguments: JSON.stringify(args),
              },
            });

            if (nextMatch) {
              regex.lastIndex = nextMatch.index;
            }
          }

          return result;
        };

        const finalizeCompletion = () => {
          if (!isMountedRef.current) return;

          if (canceledMessageIdsRef.current.has(message_id)) {
            flushQueuedChunksForMessage(message_id);
            setMessages((prev) => finalizeStoppedMessage(prev, message_id));
            ownedStreamMessageIdsRef.current.delete(message_id);
            setIsLoading(false);
            setIsStopping(false);
            return;
          }

          if (tool_calls && tool_calls.length > 0) {
            const validNames = allConfiguredTools.map((t) => t.name);
            finalToolCalls = tool_calls.map((tc) => {
              if (validNames.includes(tc.function.name)) return tc;
              const match = findBestToolMatch(tc.function.name, validNames);
              if (match) {
                logDebug(`工具名称修正: ${tc.function.name} → ${match}`, 'ChatPanel');
                return { ...tc, function: { ...tc.function, name: match } };
              }
              return tc;
            });
            logDebug('AI请求使用工具: ' + JSON.stringify(finalToolCalls), 'ChatPanel');
          } else {
            const currentMsg = messagesRef.current.find((m) => m.id === message_id);
            const msgContent = currentMsg?.content;
            if (typeof msgContent === 'string' && msgContent.includes('[Tool:')) {
              pseudoToolCalls = extractPseudoToolCalls(msgContent);
              if (pseudoToolCalls.length > 0) {
                finalToolCalls = pseudoToolCalls;
                logDebug('AI请求使用工具(解析自文本): ' + JSON.stringify(pseudoToolCalls), 'ChatPanel');
              }
            }
          }

          setMessages((prev) => {
            const index = prev.findIndex((m) => m.id === message_id);
            if (index === -1) return prev;

            const updated = [...prev];
            const message = { ...updated[index] };
            message.isStreaming = false;
            message.endTime = Date.now();

            const rawContent = message.rawContent ?? message.content ?? '';
            const rawThinking = message.rawThinking ?? message.thinking ?? '';
            const separated = finalizeStreamMessage({
              rawContent,
              rawThinking,
              streamContent: message.content,
              streamThinking: message.thinking,
              receivedThinkingChunks: message.receivedThinkingChunks,
              hasToolCalls: Boolean(finalToolCalls && finalToolCalls.length > 0),
            });
            message.content = separated.content;
            message.thinking = separated.thinking;
            message.isThinking = false;

            if (message.thinking) {
              if (!message.thinkingStartedAt) {
                message.thinkingStartedAt = message.firstChunkTime ?? message.startTime;
              }
              if (!message.thinkingEndedAt) {
                message.thinkingEndedAt = message.firstContentTime ?? message.endTime;
              }
            }

            if (finalToolCalls && finalToolCalls.length > 0) {
              message.tool_calls = finalToolCalls;
            }

            const contentTokens = estimateMessageTokens({
              role: message.role,
              content: message.content,
            });
            const thinkingTokens = message.thinking ? estimateTokens(message.thinking) : 0;
            message.tokens = contentTokens + thinkingTokens;

            updated[index] = message;
            // Keep ref in lockstep for tool-loop saves (useEffect lags one frame).
            messagesRef.current = updated;
            return updated;
          });

          // Always snapshot after a stream finishes (with or without tools).
          // Previously only non-tool completions were saved, so plan-mode tool
          // turns vanished if the app closed while exit_plan_mode was waiting.
          if (autoSaveTimeoutRef.current != null) {
            window.clearTimeout(autoSaveTimeoutRef.current);
          }
          autoSaveTimeoutRef.current = window.setTimeout(() => {
            if (!isMountedRef.current) return;
            void saveCurrentConversation();
          }, 300);

          if (finalToolCalls && finalToolCalls.length > 0) {
            handleToolCallsRef.current?.(finalToolCalls);
          } else {
            setIsLoading(false);
          }

          ownedStreamMessageIdsRef.current.delete(message_id);
        };

        streamCompletionCoordinatorRef.current?.complete(message_id, finalizeCompletion);
      }
    );

    const unlistenToolExecuted = listen<{
      message_id: string;
      tool_name: string;
      tool_call_id: string;
      result_preview: string;
      success: boolean;
      round: number;
      total_rounds_so_far: number;
    }>('ai-tool-executed', (event) => {
      if (!isMountedRef.current) return;
      
      const { message_id, tool_name, tool_call_id, result_preview, success, round, total_rounds_so_far } = event.payload;
      
      setMessages((prev) => 
        prev.map((msg) => {
          if (msg.id === message_id) {
            const newExecutedTool = {
              tool_name,
              tool_call_id,
              result_preview,
              success,
              round,
              total_rounds_so_far,
            };
            return {
              ...msg,
              executedTools: [...(msg.executedTools || []), newExecutedTool],
            };
          }
          return msg;
        })
      );
    });

    const unlistenError = listen<{ message_id?: string; error: string }>(
      'ai-stream-error',
      (event) => {
        if (!isMountedRef.current) return;

        const { message_id, error: errorMsg } = event.payload;
        if (!message_id || !ownedStreamMessageIdsRef.current.has(message_id)) {
          return;
        }

        streamCompletionCoordinatorRef.current?.cancel(message_id);
        ownedStreamMessageIdsRef.current.delete(message_id);

        if (canceledMessageIdsRef.current.has(message_id)) {
          flushQueuedChunksForMessage(message_id);
          setMessages((prev) => finalizeStoppedMessage(prev, message_id));
          setIsLoading(false);
          setIsStopping(false);
          return;
        }

        const { message: displayError, unauthorized } = resolveBuiltinStreamError(
          errorMsg,
          t.settingsBuiltin.unauthorized,
          { treatAsBuiltin: isBuiltinProtocol(protocolSelectionRef.current) }
        );
        if (unauthorized) {
          useBuiltinGatewayStore.setState({ error: 'UNAUTHORIZED', status: 'error' });
        }
        setError(`${t.errors.streamOutputError}: ${displayError}`);
        setIsLoading(false);
        setIsStopping(false);

        setMessages((prev) => {
          const index = prev.findIndex((m) => m.id === message_id);
          if (index === -1) return prev;
          const now = Date.now();
          return prev.map((m, i) =>
            i === index
              ? {
                  ...m,
                  isStreaming: false,
                  thinkingEndedAt: m.thinkingEndedAt ?? now,
                  endTime: m.endTime ?? now,
                }
              : m
          );
        });
      }
    );

    const unlistenProviderSwitched = listen<{
      message_id: string;
      from_provider: string;
      from_model: string;
      to_provider: string;
      to_model: string;
    }>('ai-provider-switched', (event) => {
      if (!isMountedRef.current) return;
      const { message_id, from_provider, from_model, to_provider, to_model } = event.payload;
      if (!message_id || !ownedStreamMessageIdsRef.current.has(message_id)) return;
      if (protocolSelectionRef.current !== 'auto') return;

      logDebug(
        `[ChatPanel] Auto-routing: ${from_provider}/${from_model} -> ${to_provider}/${to_model}`,
        'ChatPanel'
      );

      chatRuntimeRef.current = {
        ...chatRuntimeRef.current,
        provider: to_provider as AIProvider,
        model: to_model,
        routingMode: 'auto',
      };

      setMessages((prev) => {
        const alreadyNotified = prev.some(
          (message) =>
            message.uiNotice?.type === 'provider-switch' &&
            message.uiNotice.fromProvider === from_provider &&
            message.uiNotice.fromModel === from_model &&
            message.uiNotice.toProvider === to_provider &&
            message.uiNotice.toModel === to_model
        );
        if (alreadyNotified) {
          return prev;
        }

        const noticeMessage: Message = {
          id: `provider-switch-${message_id}-${Date.now()}`,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          uiNotice: {
            type: 'provider-switch',
            fromProvider: from_provider,
            fromModel: from_model,
            toProvider: to_provider,
            toModel: to_model,
          },
        };

        const anchorIndex = prev.findIndex((message) => message.id === message_id);
        if (anchorIndex >= 0) {
          return [
            ...prev.slice(0, anchorIndex),
            noticeMessage,
            ...prev.slice(anchorIndex),
          ];
        }
        return [...prev, noticeMessage];
      });
    });

    const unlistenCancelled = listen<{ message_id: string }>('ai-stream-cancelled', (event) => {
      if (!isMountedRef.current) return;

      const { message_id } = event.payload;
      if (!message_id || !ownedStreamMessageIdsRef.current.has(message_id)) {
        return;
      }

      canceledMessageIdsRef.current.add(message_id);
      streamCompletionCoordinatorRef.current?.cancel(message_id);
      flushQueuedChunksForMessage(message_id);
      ownedStreamMessageIdsRef.current.delete(message_id);

      setMessages((prev) => finalizeStoppedMessage(prev, message_id));
      setIsLoading(false);
      setIsStopping(false);
      setCurrentAssistantMessageId((current) => (current === message_id ? null : current));
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolExecuted.then((fn) => fn());
      unlistenProviderSwitched.then((fn) => fn());
      unlistenCancelled.then((fn) => fn());
    };
  }, [enqueueStreamChunk, flushQueuedChunksForMessage]);

  useEffect(() => {
    const handler = () => {
      createNewConversation();
    };

    window.addEventListener(CHAT_NEW_CONVERSATION_EVENT, handler as EventListener);
    return () => window.removeEventListener(CHAT_NEW_CONVERSATION_EVENT, handler as EventListener);
  }, [createNewConversation]);

  const showPendingChangesBar =
    pendingChanges.length > 0 && !isLoading && !isStopping;

  const handleOpenPendingChangeFile = useCallback((filePath: string) => {
    window.dispatchEvent(
      new CustomEvent('open-file-in-editor', {
        detail: { filePath },
      })
    );
  }, []);
  const modelMissing = !isAutoRouting && !selectedModel.trim();
  const currentVisionCapability =
    visionCapabilities[effectiveProvider] || DEFAULT_VISION_CAPABILITIES[effectiveProvider];
  const hasVisionInput = attachedImages.length > 0;
  const hasInput = !!inputValue.trim() || attachedFiles.length > 0 || hasVisionInput;
  const visionBlocked = hasVisionInput && !currentVisionCapability.supportsVision;
  const canSend = hasInput && !isLoading && !isStopping && !modelMissing && !visionBlocked;
  const showStop = isLoading || isStopping;
  const isConversationSwitchLocked = isLoading || isStopping || isExecutingToolsRef.current;

  const chatConversationId = currentConversation?.id ?? '';
  const chatPlanVisible = usePlanDocumentVisible(chatConversationId || null);
  const chatPlanForceExpand = Boolean(
    chatConversationId && planReviewConversationId === chatConversationId,
  );
  // Anchored after the plan-tool turn inside the message list (not sticky list end).
  const chatPlanSlot = useMemo(() => {
    if (!chatConversationId || !chatPlanVisible) return null;
    return (
      <PlanDocumentPanel
        conversationId={chatConversationId}
        variant="inline"
        showOpenInEditor
        autoOpenInEditor={false}
        forceExpand={chatPlanForceExpand}
        onAccept={(planDoc) => {
          settleExitPlanReview(chatConversationId, planDoc);
        }}
      />
    );
  }, [chatConversationId, chatPlanVisible, chatPlanForceExpand, settleExitPlanReview]);

  useEffect(() => {
    if (modelMissing && inputValue) {
      setInputValue('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
  }, [modelMissing]);

  useEffect(() => {
    if (!modelMissing && error === '请选择模型') {
      setError(null);
    }
  }, [modelMissing, selectedModel]);

  useEffect(() => {
    if (!hasVisionInput && error === VISION_UNSUPPORTED_ERROR) {
      setError(null);
      return;
    }
    if (hasVisionInput && !currentVisionCapability.supportsVision) {
      setError(VISION_UNSUPPORTED_ERROR);
      return;
    }
    if (error === VISION_UNSUPPORTED_ERROR) {
      setError(null);
    }
  }, [currentVisionCapability.supportsVision, error, hasVisionInput]);

  const MAX_CONTEXT_TOKENS = maxContextTokens;
  const safeTotalTokens = totalTokens || 0;
  const ctxPercent = MAX_CONTEXT_TOKENS > 0 ? (safeTotalTokens / MAX_CONTEXT_TOKENS) * 100 : 0;

  const handlePickAttachFiles = useCallback(async () => {
    if (!isTauri()) {
      setError(t.chat.attachFileDesktopOnly);
      return;
    }

    try {
      const selected = await openDialog({
        directory: false,
        multiple: true,
        defaultPath: projectPath || undefined,
      });
      if (selected === null) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop() || path;
        if (isImageFilePath(path)) {
          await addImagePathToContext(path);
        } else {
          await addFileToContext(path, name);
        }
      }
    } catch (error) {
      if (isTauriCancellationError(error)) return;
      setError(t.chat.attachFileFailed.replace('{error}', String(error)));
    }
  }, [
    addFileToContext,
    addImagePathToContext,
    projectPath,
    setError,
    t.chat.attachFileDesktopOnly,
    t.chat.attachFileFailed,
  ]);

  const requestDeleteCurrentConversation = useCallback(() => {
    if (!currentConversation) return;
    const meta = conversations.find((conv) => conv.id === currentConversation.id);
    if (!meta) return;
    requestDeleteConversation(
      { stopPropagation: () => undefined } as React.MouseEvent,
      meta
    );
  }, [conversations, currentConversation, requestDeleteConversation]);

  return (
    <div
      className={styles.container}
      style={{
        width: `${width}px`,
      }}
      data-clipboard-surface="true"
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.headerIconButton}
          aria-label={t.chat.newConversation}
          title={t.chat.newConversation}
          disabled={isConversationSwitchLocked}
          onClick={createNewConversation}
        >
          <PlusIcon size={14} />
        </button>
        <div className={styles.headerSelector}>
          <ConversationSelector
            currentConversation={currentConversation}
            conversations={conversations}
            isConversationDropdownOpen={isConversationDropdownOpen}
            setIsConversationDropdownOpen={setIsConversationDropdownOpen}
            conversationDropdownRef={conversationDropdownRef}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            renameInputRef={renameInputRef}
            isConversationSwitchLocked={isConversationSwitchLocked}
            loadConversation={loadConversation}
            handleStartRename={handleStartRename}
            handleRenameSubmit={handleRenameSubmit}
            handleCancelRename={handleCancelRename}
            requestDeleteConversation={requestDeleteConversation}
            t={t}
          />
        </div>
        <ChatHeaderActions
          isConversationSwitchLocked={isConversationSwitchLocked}
          currentConversation={currentConversation}
          conversations={conversations}
          handleStartRename={handleStartRename}
          requestDeleteCurrentConversation={requestDeleteCurrentConversation}
          showStoragePath={showStoragePath}
          t={t}
        />
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'color-mix(in srgb, var(--text-error) 10%, var(--bg-app))',
            borderBottom: '1px solid color-mix(in srgb, var(--text-error) 24%, var(--border-primary))',
            color: 'var(--text-error)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
          <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            title={t.actions.close}
            aria-label={t.actions.close}
            style={{
              flexShrink: 0,
              width: '20px',
              height: '20px',
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: 'var(--text-error)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className={styles.contentArea}>
        <ChatMessageList
          messages={messages}
          pendingChanges={pendingChanges}
          showPendingChangesBar={showPendingChangesBar}
          pendingChangesCollapsed={isPendingChangesCollapsed}
          setPendingChangesCollapsed={setIsPendingChangesCollapsed}
          onOpenPendingChangeFile={handleOpenPendingChangeFile}
          onAcceptPendingChange={acceptPendingChange}
          onRollbackPendingChange={async (change) => {
            await rejectPendingChange(change);
          }}
          t={t}
          onApprovePendingToolCalls={approvePendingToolCalls}
          onDenyPendingToolCalls={denyPendingToolCalls}
          onResendFromUserMessage={handleResendFromUserMessage}
          virtuosoRef={virtuosoRef}
          messagesContainerRef={messagesContainerRef}
          scrollerRef={scrollerRef}
          followOutput={followOutput}
          atBottomThreshold={atBottomThreshold}
          onAtBottomStateChange={onAtBottomStateChange}
          onTotalListHeightChanged={onTotalListHeightChanged}
          onIsScrolling={onIsScrolling}
          showScrollButton={showScrollButton}
          isUserScrollingRef={isUserScrollingRef}
          onScrollToBottom={scrollToBottom}
          emptyStateText={t.chat.whatCanHelpToday}
          watchKey={currentConversation?.id ?? null}
          bottomOverlayInset={bottomOverlayInset}
          bottomDockRevision={bottomDockRevision}
          planSlot={chatPlanSlot}
        />
      </div>

      <div ref={bottomDockRef} className={styles.bottomDock}>
        {currentConversation?.id && (
          <TodoListBar
            conversationId={currentConversation.id}
            onLayoutChange={handleOverlayChange}
          />
        )}

        <ComposerQuestionAnchor
        questions={
          currentConversation?.id ? pendingQuestionsByConversation[currentConversation.id] : undefined
        }
        onSubmit={handleSubmitPendingQuestions}
        onCancel={handleCancelPendingQuestions}
      >
        <ChatInputArea
          inputValue={inputValue}
          setInputValue={setInputValue}
          isLoading={isLoading}
          isStopping={isStopping}
          canSend={canSend}
          showStop={showStop}
          modelMissing={modelMissing}
          visionBlocked={visionBlocked}
          isDragOver={isDragOver}
          isOverChatAttach={isOverChatAttach}
          attachedFiles={attachedFiles}
          attachedImages={attachedImages}
          textareaRef={textareaRef}
          inputCardRef={inputCardRef}
          setChatAttachRef={setChatAttachRef}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          handleInputPaste={handleInputPaste}
          removeFileFromContext={removeFileFromContext}
          removeImageFromContext={removeImageFromContext}
          handleSendMessage={handleSendMessage}
          handleStop={handleStop}
          onPickAttachFiles={handlePickAttachFiles}
          invocableSkills={invocableSkills}
          metaLeft={
            <TokenRingIndicator
              safeTotalTokens={safeTotalTokens}
              ctxPercent={ctxPercent}
              MAX_CONTEXT_TOKENS={MAX_CONTEXT_TOKENS}
              showInlineUsage={false}
              t={t}
            />
          }
          metaToolbarRight={
            <ChatModeToggle
              chatMode={chatMode}
              setChatMode={setChatMode}
              variant="composer"
              compact
              t={t}
            />
          }
          metaRight={
            <ProviderModelSelector
              selectedProtocol={protocolSelection}
              onSelectProtocol={setProtocolSelection}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              availableModels={availableModels}
              isDropdownOpen={isDropdownOpen}
              setIsDropdownOpen={setIsDropdownOpen}
              isModelDropdownOpen={isModelDropdownOpen}
              setIsModelDropdownOpen={setIsModelDropdownOpen}
              dropdownRef={dropdownRef}
              modelDropdownRef={modelDropdownRef}
              autoRoutingLabel={t.agent.autoRouting}
              variant="ghost"
              t={t}
            />
          }
          t={t}
        />
      </ComposerQuestionAnchor>
      </div>

      <StoragePathModal
        storagePath={storagePath}
        setStoragePath={setStoragePath}
        isCopied={isCopied}
        copyStoragePath={copyStoragePath}
        t={t}
      />

      <DeleteConversationModal
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        isDeletingConversation={isDeletingConversation}
        confirmDeleteConversation={confirmDeleteConversation}
        t={t}
      />
    </div>
  );
}
