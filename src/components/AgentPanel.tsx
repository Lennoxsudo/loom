import styles from './AgentPanel.module.css';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import { invoke } from '@tauri-apps/api/core';

import { useTranslation, useLocale } from '../i18n';
import { useNotification } from '../contexts/NotificationContext';
import { useAgentAccessMode, useStreamSpeed, useThinkingBlockAutoExpand, useRecentWorkspaces, useTouchRecentWorkspace, useRemoveRecentWorkspace, useUpdateAgentAccessMode, useReasoningEffort, useUpdateReasoningEffort, useEnableCodeGraph, useGraphAutoIndexOnOpen, useGraphAutoIndexMaxFiles } from '../stores';
import { useCbmGraphReady } from '../stores/useCbmStore';
import { useCbmIndexEvents } from '../hooks/useCbmIndexEvents';
import { useCbmConfigSync } from '../hooks/useCbmConfigSync';
import { isCbmSkippedTooLarge, scheduleCbmWorkspaceIndex } from '../utils/cbmRuntime';
import AgentNavSidebar from './agent/AgentNavSidebar';
import AgentThreadDeleteDialog from './agent/AgentThreadDeleteDialog';
import AgentProjectDeleteDialog from './agent/AgentProjectDeleteDialog';
import AgentComposer from './agent/AgentComposer';
import AgentContextBar from './agent/AgentContextBar';
import AgentWelcomeState from './agent/AgentWelcomeState';
import ChangeReviewPanel from './agent/ChangeReviewPanel';
import { useAgentApproval } from './agent/useAgentApproval';
import { AgentContent, type AgentSettingsSection } from './settings/AgentContent';
import settingsViewStyles from './settings/AgentSettingsView.module.css';
import TodoListBar from './agent/TodoListBar';
import PlanDocumentPanel from './agent/PlanDocumentPanel';
import ComposerQuestionAnchor from './agent/ComposerQuestionAnchor';
import AgentMessageList, { type AgentMessageListHandle } from './agent/AgentMessageList';
import type { PlanDocument } from '../features/agent-engine/planStore';
import { setPlan } from '../features/agent-engine/planStore';
import { usePlanDocumentVisible } from '../features/agent-engine/usePlanDocumentVisible';

import {
  type Agent,
  type AIProvider,
  type AgentProtocolSelection,
  saveAgent,
  saveProjectState,
  touchProjectIndex,
  loadAllProjectThreadSummaries,
  type ProjectThreadSummary,
} from '../utils/agentPersistence';
import { getSkillsList } from '../utils/skills';
import { stripMcpToolPrefix } from './agent/toolResultLayout';
import {
  toOpenAITools,
  toAnthropicTools,
  toGeminiTools,
  type ToolCall,
  AI_TOOLS,
  filterToolsByContext,
  dedupeToolsByName,
} from '../features/agent-engine';
import type { ToolDefinition } from '../types/ai';
import type { QuestionInput, UserAnswer } from '../features/agent-engine/toolArgs';
import { useToolStore } from '../stores/useToolStore';
import { useCheckpointStore, selectSessionCheckpoints } from '../stores/useCheckpointStore';
import type { AgentCheckpoint } from '../utils/checkpointTimeline';
import { useImageGenConfig } from '../hooks/useImageGenConfig';
import {
  buildGenerateImageTool,
  getConfiguredImageModels,
  isImageGenConfigured,
} from '../utils/imageGenConfig';
import { useAgentAttachments, VISION_UNSUPPORTED_ERROR } from './agent/hooks/useAgentAttachments';
import { useAgentPreviewPanel } from './agent/hooks/useAgentPreviewPanel';
import { useAgentInit, loadProjectConversationStateFromDisk, seedProjectPersistenceSnapshot } from './agent/hooks/useAgentInit';
import { useHydrateSubagentRuns } from './agent/hooks/useHydrateSubagentRuns';
import { useAgentStreamingQueue } from './agent/hooks/useAgentStreamingQueue';
import {
  useAgentStreamEvents,
} from './agent/hooks/useAgentStreamEvents';
import { extractKnownToolNamesFromProviderTools } from '../features/agent-engine/streamCompletionToolCalls';
import { useAgentStreamControl } from './agent/hooks/useAgentStreamControl';
import { useAgentSendMessage } from './agent/hooks/useAgentSendMessage';
import { useAgentConversationPersistence } from './agent/hooks/useAgentConversationPersistence';
import { useAgentThreadManager } from './agent/hooks/useAgentThreadManager';
import { useAgentSessionExtrasPersistence } from './agent/hooks/useAgentSessionExtrasPersistence';
import { useAgentProjectTreeState } from './agent/hooks/useAgentProjectTreeState';
import { useAgentPendingChanges } from './agent/hooks/useAgentPendingChanges';
import { useAutomationEvent } from './agent/hooks/useAutomationEvent';
import AutomationsPanel from './agent/AutomationsPanel';
import { useAgentToolCalls } from './agent/hooks/useAgentToolCalls';
import {
  filterToolsByCapabilities,
  normalizeCapabilities,
} from '../utils/agentTools';
import { isToolFilteredInReadOnlyProviderList } from '../utils/agentAccessMode';
import {
  buildPendingSessionKey,
  buildComposeDraftSessionKey,
  resolveSelectedThreadId,
  parseProviderAndModel,
  normalizeProjectPath,
  collectProjectPathsFromState,
  emptyProjectConversationState,
  applyPreferredThreadSelection,
  toProjectConversationStateForPersistence,
  resolveDraftSessionKey,
} from './agent/utils';
import {
  agentModelSelectionsMatch,
  listProviderProfiles,
  resolveComparableAgentModel,
  resolveExplicitProfileSelection,
  resolveModelSelection,
  type LoadedAiConfig,
  type ProviderProfileOption,
} from '../utils/aiProviderRuntime';
import { buildAgentContextUsage } from './agent/contextUsage';
import { smoothScrollToBottom } from '../utils/smoothScroll';
import { scheduleScrollContainerToBottom } from '../utils/scheduleMessageListScroll';
import { deleteProjectFromWorkspace } from '../utils/deleteProjectFromWorkspace';
import type { RecentWorkspace } from '../types/settings';
import ScrollToBottomButton from './shared/ScrollToBottomButton';
import ChangeCountCapsule from './agent/ChangeCountCapsule';
import BgTaskBadge from './agent/BgTaskBadge';
import MessageAnchorRail from './agent/MessageAnchorRail';
import UserMessageStickyBar from './agent/UserMessageStickyBar';
import { scrollToMessage } from './agent/messageScrollUtils';
import { useUserMessageLayoutRegistry } from './agent/hooks/useUserMessageLayoutRegistry';
import { usePinnedUserMessage } from './agent/hooks/usePinnedUserMessage';
import {
  type AgentConversationState,
  type AgentThreadSettings,
  type StreamMeta,
  type AgentBusyChangeDetail,
  AGENT_BUSY_CHANGE_EVENT,
  AGENT_MODES_STORAGE_KEY,
} from '../types/chat';
import { desktopShellStyle, sessionColumnStyle } from './agent/panelStyles';

interface AgentPanelProps {
  projectPath: string;
  onProjectPathChange?: (path: string) => void;
  onFilesChanged?: (paths: string[]) => void;
}

export default function AgentPanel({
  projectPath,
  onProjectPathChange,
  onFilesChanged,
}: AgentPanelProps) {
  const t = useTranslation();
  const language = useLocale();
  const { showWarning, showInfo, showError } = useNotification();
  const agentAccessMode = useAgentAccessMode();
  const updateAgentAccessMode = useUpdateAgentAccessMode();
  const reasoningEffort = useReasoningEffort();
  const updateReasoningEffort = useUpdateReasoningEffort();
  const thinkingBlockAutoExpand = useThinkingBlockAutoExpand();
  const enableCodeGraph = useEnableCodeGraph();
  const graphAutoIndexOnOpen = useGraphAutoIndexOnOpen();
  const graphAutoIndexMaxFiles = useGraphAutoIndexMaxFiles();
  const cbmGraphEnabled = useCbmGraphReady(enableCodeGraph);
  useCbmIndexEvents(cbmGraphEnabled && graphAutoIndexOnOpen);
  useCbmConfigSync();
  const mcpTools = useToolStore((s) => s.mcpTools);
  const imageGenConfig = useImageGenConfig();
  const getAgentToolDefinitions = (currentAgentId?: string): ToolDefinition[] => {
    const currentAgent = agentRef.current;
    const baseTools = dedupeToolsByName(
      [
        ...AI_TOOLS,
        ...(isImageGenConfigured(imageGenConfig) ? [buildGenerateImageTool(imageGenConfig)] : []),
        ...mcpTools,
      ]
    );
    const shouldApplyGlobalCommandPolicy = !!currentAgent;
    const capabilityForFilter =
      shouldApplyGlobalCommandPolicy && currentAgent?.capabilities
        ? { ...currentAgent.capabilities, canExecuteCommands: true }
        : currentAgent?.capabilities;
    const modeForAgent = agentModesRef.current[currentAgentId ?? ''] ?? 'always-allow';

    const cacheKey = currentAgentId ?? '';
    const deps = [
      mcpTools.map((t) => t.name).join(','),
      String(isImageGenConfigured(imageGenConfig)),
      getConfiguredImageModels(imageGenConfig).join(','),
      imageGenConfig.endpoint,
      JSON.stringify(capabilityForFilter),
      modeForAgent,
      String(agentAccessMode),
      JSON.stringify(projectContextRef.current),
      String(cbmGraphEnabled),
    ].join('|');

    const cached = rawAgentToolsCacheRef.current[cacheKey];
    if (cached && cached.deps === deps) {
      return cached.tools;
    }

    let filteredBaseTools = filterToolsByCapabilities(
      baseTools,
      capabilityForFilter,
      modeForAgent === 'plan',
    );

    filteredBaseTools = filterToolsByContext(filteredBaseTools, {
      isGitRepo: projectContextRef.current.isGitRepo,
      hasBrowserCapability: normalizeCapabilities(currentAgent?.capabilities).canAccessBrowser,
      enableCodeGraph: cbmGraphEnabled,
    });

    if (shouldApplyGlobalCommandPolicy && agentAccessMode === 'read_only') {
      filteredBaseTools = filteredBaseTools.filter(
        (tool) => !isToolFilteredInReadOnlyProviderList(tool.name)
      );
    }

    rawAgentToolsCacheRef.current[cacheKey] = { tools: filteredBaseTools, deps };
    return filteredBaseTools;
  };

  const getProviderTools = (
    provider: AIProvider,
    currentAgentId?: string
  ) => {
    const cacheKey = `${provider}::${currentAgentId ?? ''}`;
    const deps = [
      mcpTools.map((t) => t.name).join(','),
      String(isImageGenConfigured(imageGenConfig)),
      getConfiguredImageModels(imageGenConfig).join(','),
      imageGenConfig.endpoint,
      JSON.stringify(agentRef.current?.capabilities ?? null),
      agentModesRef.current[currentAgentId ?? ''] ?? 'always-allow',
      String(agentAccessMode),
      JSON.stringify(projectContextRef.current),
      String(cbmGraphEnabled),
    ].join('|');

    const cached = providerToolsCacheRef.current[cacheKey];
    if (cached && cached.deps === deps) {
      return cached.tools;
    }

    const filteredBaseTools = getAgentToolDefinitions(currentAgentId);

    let tools: unknown[];
    if (provider === 'anthropic') {
      tools = toAnthropicTools(filteredBaseTools);
    } else if (provider === 'gemini') {
      tools = toGeminiTools(filteredBaseTools);
    } else {
      tools = toOpenAITools(filteredBaseTools);
    }

    providerToolsCacheRef.current[cacheKey] = { tools, deps };
    return tools;
  };

  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversationState, setConversationState] = useState<AgentConversationState>(
    emptyProjectConversationState()
  );
  const [activeProjectKey, setActiveProjectKey] = useState('');
  const [diskThreadSummariesByProject, setDiskThreadSummariesByProject] = useState<
    Record<string, ProjectThreadSummary[]>
  >({});
  const [draftMessage, setDraftMessage] = useState('');
  const [currentBudget, setCurrentBudget] = useState<number>(0);
  const [currentTokens, setCurrentTokens] = useState<number>(0);
  const [agentModes, setAgentModes] = useState<Record<string, 'plan' | 'always-allow'>>(() => {
    try {
      const stored = localStorage.getItem(AGENT_MODES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) {
          // 验证值类型
          const valid: Record<string, 'plan' | 'always-allow'> = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (value === 'plan' || value === 'always-allow') {
              valid[key] = value;
            }
          }
          return valid;
        }
      }
    } catch {
      // ignore parse errors
    }
    return {};
  });
  const agentModesRef = useRef(agentModes);
  useEffect(() => {
    agentModesRef.current = agentModes;
  }, [agentModes]);
  // 持久化 agentModes 到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AGENT_MODES_STORAGE_KEY, JSON.stringify(agentModes));
    } catch {
      // ignore persist failures
    }
  }, [agentModes]);

  const [planReviewConversationId, setPlanReviewConversationId] = useState<string | null>(null);
  const handleSendCurrentMessageRef = useRef<(() => Promise<void>) | null>(null);
  const [busySessionKeys, setBusySessionKeys] = useState<Set<string>>(() => new Set());
  const [busyAgentIds, setBusyAgentIds] = useState<Set<string>>(() => new Set());
  const [projectBranchName, setProjectBranchName] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renamingConversationTitle, setRenamingConversationTitle] = useState('');
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(new Set());
  const [isAutomationsPanelOpen, setIsAutomationsPanelOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'workspace' | 'settings'>('workspace');
  const [settingsSection, setSettingsSection] = useState<AgentSettingsSection>('general');
  const [changeReviewCollapsed, setChangeReviewCollapsed] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<AgentProtocolSelection>('openai');
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableProfiles, setAvailableProfiles] = useState<ProviderProfileOption[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const lastModelSyncAgentIdRef = useRef<string | null>(null);
  const lastThreadSettingsHydrationKeyRef = useRef('');
  const recentWorkspaces = useRecentWorkspaces();
  const touchRecentWorkspace = useTouchRecentWorkspace();
  const removeRecentWorkspace = useRemoveRecentWorkspace();
  const { requestApproval, approve, reject } = useAgentApproval();
  const [isEmptyStateVisible, setIsEmptyStateVisible] = useState(false);
  const [isEmptyStateExiting, setIsEmptyStateExiting] = useState(false);
  const [isAgentContentEntering, setIsAgentContentEntering] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [skillsCount, setSkillsCount] = useState(0);
  const [skillNames, setSkillNames] = useState<string[]>([]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    getSkillsList(projectPath).then(({ global: globalSkills, project: projectSkills }) => {
      if (!cancelled) {
        const projectNameSet = new Set(projectSkills.map((skill) => skill.name));
        const merged = [
          ...globalSkills.filter((skill) => !projectNameSet.has(skill.name)),
          ...projectSkills,
        ];
        const names = merged.map((skill) => skill.name).sort((a, b) => a.localeCompare(b));
        setSkillNames(names);
        setSkillsCount(names.length);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const mcpToolNames = useMemo(
    () =>
      [...new Set(mcpTools.map((tool) => stripMcpToolPrefix(tool.name)))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [mcpTools],
  );

  const {
    pendingChangesBySession,
    setPendingChangesBySession,
    saveDraftForSession,
    loadDraftForSession,
    clearSessionExtras,
    clearSessionExtrasForProject,
    extrasLoaded,
  } = useAgentSessionExtrasPersistence();

  const [pendingDeleteProject, setPendingDeleteProject] = useState<RecentWorkspace | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const [pendingQuestionsByAgent, setPendingQuestionsByAgent] = useState<
    Record<string, QuestionInput[]>
  >({});
  const resolveQuestionsByAgentRef = useRef<Record<string, (answers: UserAnswer[]) => void>>({});

  const activeStreamMessageIdsBySessionRef = useRef<Record<string, string>>({});
  const activeStreamMessageIdsByAgentRef = useRef<Record<string, Set<string>>>({});
  const streamMetaByMessageIdRef = useRef<Record<string, StreamMeta>>({});
  const streamFlushRef = useRef<{
    flushAllQueuedChunks: () => void;
    drainQueuedChunksFast: (onComplete?: () => void) => void;
  }>({
    flushAllQueuedChunks: () => {},
    drainQueuedChunksFast: () => {},
  });
  const busySessionKeysRef = useRef<Set<string>>(new Set());
  const busyAgentIdsRef = useRef<Set<string>>(new Set());
  const threadSettingsRef = useRef<AgentThreadSettings | undefined>(undefined);
  const agentRuntimeRef = useRef<{
    provider: AIProvider;
    model: string;
    profileId?: string;
    routingMode?: 'manual' | 'auto';
  }>({
    provider: 'openai',
    model: '',
    routingMode: 'manual',
  });

  const syncAgentRuntimeRef = useCallback(
    (partial: {
      provider?: AIProvider;
      model?: string;
      profileId?: string;
      routingMode?: 'manual' | 'auto';
    }) => {
      agentRuntimeRef.current = {
        ...agentRuntimeRef.current,
        ...partial,
      };
    },
    []
  );

  const applyModelSelectionFromConfig = useCallback(
    async (
      provider: AIProvider,
      model: string,
      profileId?: string,
      fallbackModel?: string,
      mode: 'explicit' | 'infer' = profileId ? 'explicit' : 'infer'
    ) => {
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (!configStr) return;
        const config = JSON.parse(configStr) as LoadedAiConfig;
        const profiles = listProviderProfiles(config, provider);
        setAvailableProfiles(profiles);

        const resolvedProfileId =
          profileId ||
          config.profiles?.[provider]?.activeId ||
          profiles[0]?.id ||
          '';

        const selection =
          mode === 'explicit' && resolvedProfileId
            ? resolveExplicitProfileSelection(
                config,
                provider,
                resolvedProfileId,
                model,
                fallbackModel
              )
            : resolveModelSelection(config, provider, model, profileId, fallbackModel);

        setAvailableModels(selection.availableModels);
        setActiveProfileId(selection.profileId ?? '');
        setSelectedModel(selection.model);
        syncAgentRuntimeRef({
          provider,
          model: selection.model,
          profileId: selection.profileId,
        });
      } catch {
        // ignore model list failures
      }
    },
    [syncAgentRuntimeRef]
  );

  const handleRuntimeReconciled = useCallback(
    (runtime: { provider: AIProvider; model: string; profileId?: string }) => {
      if (selectedProvider === 'auto') return;
      setSelectedProvider(runtime.provider);
      setSelectedModel(runtime.model);
      setActiveProfileId(runtime.profileId ?? '');
    },
    [selectedProvider]
  );

  const handleSelectProvider = useCallback(
    (selection: AgentProtocolSelection) => {
      if (selection === 'auto') {
        setSelectedProvider('auto');
        syncAgentRuntimeRef({ routingMode: 'auto' });
        return;
      }

      const provider = selection;
      setSelectedProvider(provider);
      setSelectedModel('');
      setActiveProfileId('');
      syncAgentRuntimeRef({ provider, model: '', profileId: undefined, routingMode: 'manual' });
      void applyModelSelectionFromConfig(
        provider,
        '',
        undefined,
        resolveComparableAgentModel(agentRef.current?.model),
        'infer'
      );
    },
    [applyModelSelectionFromConfig, syncAgentRuntimeRef]
  );

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      if (selectedProvider === 'auto') return;
      void applyModelSelectionFromConfig(
        selectedProvider,
        selectedModel,
        profileId,
        resolveComparableAgentModel(agentRef.current?.model),
        'explicit'
      );
    },
    [applyModelSelectionFromConfig, selectedModel, selectedProvider]
  );

  const handleSelectModel = useCallback(
    (model: string) => {
      if (selectedProvider === 'auto') return;
      void applyModelSelectionFromConfig(
        selectedProvider,
        model,
        activeProfileId || undefined,
        resolveComparableAgentModel(agentRef.current?.model),
        'explicit'
      );
    },
    [activeProfileId, applyModelSelectionFromConfig, selectedProvider]
  );
  const projectBranchNameRef = useRef<string | null>(null);
  projectBranchNameRef.current = projectBranchName;
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;
  const skipProjectBootstrapRef = useRef(false);
  const projectContextRef = useRef<{ isGitRepo: boolean }>({ isGitRepo: true });
  const appDataPathRef = useRef<string | null>(null);
  // Lazily fetch and cache appDataPath for toolChainConfig
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
  const onFilesChangedRef = useRef(onFilesChanged);
  const agentRef = useRef<Agent | null>(null);
  const conversationStateRef = useRef<AgentConversationState>(emptyProjectConversationState());
  const autoTitleRequestedRef = useRef<Set<string>>(new Set());
  const activeProjectKeyRef = useRef('');
  const selectedAgentIdRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const providerToolsCacheRef = useRef<Record<string, { tools: unknown[]; deps: string }>>({});
  const rawAgentToolsCacheRef = useRef<Record<string, { tools: ToolDefinition[]; deps: string }>>({});
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<AgentMessageListHandle>(null);
  const isNearBottomRef = useRef(true);
  const panelContentRef = useRef<HTMLDivElement>(null);
  const panelIdRef = useRef(`agent-panel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inputCardRef = useRef<HTMLDivElement>(null);
  const previousSelectedAgentIdRef = useRef<string | null>(null);
  const previousAutoScrollSnapshotRef = useRef<{
    agentId: string | null;
    conversationId: string | null;
    messageCount: number;
  }>({
    agentId: null,
    conversationId: null,
    messageCount: 0,
  });
  const scrollTopBySessionRef = useRef<Record<string, number>>({});
  const cancelSmoothScrollRef = useRef<(() => void) | null>(null);
  const previousContentAgentIdRef = useRef<string | null>(null);
  const contentEnterTimerRef = useRef<number | null>(null);

  const streamSpeed = useStreamSpeed();

  // 自动调整输入框高度
  useEffect(() => {
    if (draftTextareaRef.current) {
      const el = draftTextareaRef.current;
      const maxHeight = 120;
      el.style.height = 'auto';
      const nextHeight = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [draftMessage]);

  useEffect(() => {
    if (!projectPath) {
      setProjectBranchName(null);
      return;
    }
    let cancelled = false;
    const loadBranch = async () => {
      try {
        const snapshot = await invoke<{
          status?: { branch?: string };
        }>('git_workspace_snapshot', { repoPath: projectPath, limit: 1 });
        if (!cancelled) {
          setProjectBranchName(snapshot.status?.branch?.trim() || null);
        }
      } catch {
        if (!cancelled) setProjectBranchName(null);
      }
    };
    void loadBranch();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    (async () => {
      try {
        const isGitRepo = await invoke<boolean>('check_git_repo', { path: projectPath }).catch(() => true);
        projectContextRef.current = { isGitRepo };
      } catch {
        // keep defaults
      }
    })();
  }, [projectPath]);

  // 用于在事件监听 useEffect 中安全引用 handleToolCalls（避免循环依赖）
  const handleToolCallsRef = useRef<
    | ((
        toolCalls: ToolCall[],
        agentId: string,
        conversationId: string,
        assistantMessageId: string
      ) => Promise<void>)
    | null
  >(null);

  const handleCancelPendingQuestions = useCallback(() => {
    if (!agent?.id) return;
    setPendingQuestionsByAgent((prev) => {
      const next = { ...prev };
      delete next[agent.id];
      return next;
    });
    const resolve = resolveQuestionsByAgentRef.current[agent.id];
    if (resolve) {
      resolve([]);
      delete resolveQuestionsByAgentRef.current[agent.id];
    }
  }, [agent?.id]);

  const pendingQuestions = agent?.id ? pendingQuestionsByAgent[agent.id] : undefined;

  const handleUserAnswers = useCallback((agentId: string, answers: UserAnswer[]) => {
    setPendingQuestionsByAgent((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
    const resolve = resolveQuestionsByAgentRef.current[agentId];
    if (resolve) {
      resolve(answers);
      delete resolveQuestionsByAgentRef.current[agentId];
    }
  }, []);

  const handleSubmitPendingQuestions = useCallback(
    (answers: UserAnswer[]) => {
      if (!agent?.id) return;
      handleUserAnswers(agent.id, answers);
    },
    [agent?.id, handleUserAnswers]
  );

  const handleAskUserQuestion = useCallback(
    (agentId: string, questions: QuestionInput[]) =>
      new Promise<UserAnswer[]>((resolve) => {
        const existingResolve = resolveQuestionsByAgentRef.current[agentId];
        if (existingResolve) {
          existingResolve([]);
        }

        resolveQuestionsByAgentRef.current[agentId] = resolve;
        setPendingQuestionsByAgent((prev) => ({
          ...prev,
          [agentId]: questions,
        }));
      }),
    []
  );

  /** Non-blocking: show plan panel; agent turn ends after exit_plan_mode tool. */
  const handleExitPlanMode = useCallback(
    (req: {
      conversationId: string;
      agentId?: string;
      plan: string;
      title?: string;
    }) => {
      setPlanReviewConversationId(req.conversationId);
    },
    [],
  );

  /** User accepted the plan — switch to execute and start a new turn. */
  const settleExitPlanReview = useCallback(
    (conversationId: string, planDoc: PlanDocument) => {
      if (planReviewConversationId === conversationId) {
        setPlanReviewConversationId(null);
      }
      if (!agent?.id) return;
      setPlan(conversationId, {
        content: planDoc.content,
        title: planDoc.title,
        status: 'accepted',
      });
      agentModesRef.current = {
        ...agentModesRef.current,
        [agent.id]: 'always-allow',
      };
      setAgentModes((prev) => ({
        ...prev,
        [agent.id]: 'always-allow',
      }));
      const title = planDoc.title?.trim();
      const continueText = title
        ? `用户已接受计划「${title}」。请立即按批准的计划执行，不要再调用 exit_plan_mode。`
        : '用户已接受计划。请立即按批准的计划执行，不要再调用 exit_plan_mode。';
      setDraftMessage(continueText);
      window.setTimeout(() => {
        void handleSendCurrentMessageRef.current?.();
      }, 80);
    },
    [agent?.id, planReviewConversationId],
  );

  const handleAgentModeChange = useCallback(
    (mode: 'plan' | 'always-allow') => {
      if (!agent?.id) return;
      setAgentModes((prev) => ({
        ...prev,
        [agent.id]: mode,
      }));
    },
    [agent?.id],
  );

  const projectName = useMemo(
    () => projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath || '—',
    [projectPath]
  );

  const selectedAgent = agent;

  const selectedConversations = conversationState.conversations ?? [];
  const selectedConversationId = resolveSelectedThreadId(conversationState, projectPath);
  const selectedConversation =
    selectedConversations.find((conv) => conv.id === selectedConversationId) ?? null;
  const agentPlanVisible = usePlanDocumentVisible(selectedConversationId);
  // 使用 useMemo 缓存 selectedMessages，避免每次渲染重新计算
  const selectedMessages = useMemo(
    () => selectedConversation?.messages ?? [],
    [selectedConversation?.messages]
  );
  const { registerUserMessage, getLayoutCache, clearLayoutCache } =
    useUserMessageLayoutRegistry(messagesContainerRef);
  const { pinnedMessage, scheduleUpdate } = usePinnedUserMessage({
    messages: selectedMessages,
    scrollContainerRef: messagesContainerRef,
    getLayoutCache,
    watchKey: selectedConversationId,
  });
  const handleUserMessageLayout = useCallback(
    (messageId: string, element: HTMLElement | null) => {
      registerUserMessage(messageId, element);
      scheduleUpdate();
    },
    [registerUserMessage, scheduleUpdate],
  );
  const handleJumpToPinnedUserMessage = useCallback(() => {
    if (!pinnedMessage || !messagesContainerRef.current) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reducedMotion ? 'auto' : 'smooth';
    const scrolled =
      messageListRef.current?.scrollToMessageId(pinnedMessage.id, behavior) ||
      scrollToMessage(
        messagesContainerRef.current,
        pinnedMessage.id,
        behavior,
        getLayoutCache(),
      );
    if (scrolled) {
      scheduleUpdate();
    }
  }, [getLayoutCache, pinnedMessage, scheduleUpdate]);
  useEffect(() => {
    clearLayoutCache();
  }, [selectedConversationId, clearLayoutCache]);
  const isEmptyConversationState =
    !!selectedAgent &&
    (!selectedConversationId || selectedMessages.length === 0);

  useEffect(() => {
    if (!selectedConversationId) return;
    const timer = setTimeout(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        container.scrollTop = container.scrollHeight;
      }
      setShowScrollButton(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedConversationId]);

  const { previewOpenByAgent, setPreviewOpenByAgent } = useAgentPreviewPanel({
    selectedAgentId: agent?.id ?? null,
    panelContentRef,
  });

  const selectedPendingSessionKey =
    activeProjectKey && selectedConversationId
      ? buildPendingSessionKey(activeProjectKey, selectedConversationId)
      : null;
  const activeScrollSessionKey =
    activeProjectKey && selectedConversationId
      ? `${activeProjectKey}::${selectedConversationId}`
      : null;
  const selectedPendingChanges = selectedPendingSessionKey
    ? (pendingChangesBySession[selectedPendingSessionKey] ?? [])
    : [];

  const sessionCheckpoints = useCheckpointStore((state) =>
    selectSessionCheckpoints(state, selectedPendingSessionKey)
  );
  const restoringCheckpointId = useCheckpointStore((state) => state.restoringId);

  useEffect(() => {
    if (!selectedPendingSessionKey) return;
    void useCheckpointStore.getState().hydrateSession(selectedPendingSessionKey);
  }, [selectedPendingSessionKey]);

  const handleRestoreCheckpoint = useCallback(
    async (checkpoint: AgentCheckpoint) => {
      const sessionKey = selectedPendingSessionKey;
      const root = projectPath?.trim();
      if (!sessionKey || !root) {
        showWarning(t.agent.changeReview.restoreFailed.replace('{error}', 'no session'));
        return;
      }
      const result = await useCheckpointStore.getState().restoreToCheckpoint({
        sessionKey,
        checkpointId: checkpoint.id,
        projectPath: root,
      });
      if (!result?.success) {
        showWarning(
          t.agent.changeReview.restoreFailed.replace(
            '{error}',
            result?.message ?? useCheckpointStore.getState().lastError ?? 'unknown'
          )
        );
        return;
      }

      // Pending-change first-before snapshots are no longer valid after time travel.
      setPendingChangesBySession((prev) => {
        if (!prev[sessionKey]) return prev;
        const next = { ...prev };
        delete next[sessionKey];
        return next;
      });

      const touched = [...result.restoredFiles, ...result.deletedFiles];
      if (touched.length > 0) {
        onFilesChangedRef.current?.(touched);
      }
      showInfo(t.agent.changeReview.restoreSucceeded);
    },
    [
      selectedPendingSessionKey,
      projectPath,
      showWarning,
      showInfo,
      t.agent.changeReview.restoreFailed,
      t.agent.changeReview.restoreSucceeded,
      setPendingChangesBySession,
    ]
  );

  const totalTokens = currentTokens;
  const tokenPercentage = currentBudget > 0 ? (totalTokens / currentBudget) * 100 : 0;

  const isSelectedSessionBusy = selectedPendingSessionKey
    ? busySessionKeys.has(selectedPendingSessionKey)
    : false;
  const isComposerBusy = isSelectedSessionBusy;

  // Attachments hook
  const {
    attachedImages,
    attachedFiles,
    isDragOver,
    visionCapabilities,
    handleInputPaste,
    handleRemoveImage,
    clearAttachedImages,
    clearAttachedFiles,
    removeFileFromContext,
    handleImageInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useAgentAttachments({
    selectedAgent,
    isSelectedAgentBusy: isComposerBusy,
    inputCardRef,
    setError,
  });

  useEffect(() => {
    let cancelled = false;

    const updateContextUsage = async () => {
      try {
        const runtimeSnapshot = agentRuntimeRef.current;
        const tools = selectedAgent
          ? getProviderTools(
              (runtimeSnapshot.provider ??
                selectedAgent.provider ??
                'openai') as AIProvider,
              selectedAgent.id,
            )
          : undefined;
        const usage = await buildAgentContextUsage({
          agent: selectedAgent,
          conversation: selectedConversation,
          draftMessage,
          attachedImages,
          projectPath: projectPathRef.current,
          agentMode:
            agent?.id ? (agentModesRef.current[agent.id] ?? 'always-allow') : 'always-allow',
          tools,
          runtimeSnapshot,
        });

        if (!cancelled) {
          setCurrentBudget(usage.availableContextTokens);
          setCurrentTokens(usage.usedTokens);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to recalculate agent context usage:', error);
          setCurrentBudget(0);
          setCurrentTokens(0);
        }
      }
    };

    void updateContextUsage();

    return () => {
      cancelled = true;
    };
  }, [
    attachedImages,
    draftMessage,
    getProviderTools,
    selectedAgent,
    agent?.id,
    selectedConversation,
    projectPath,
    agentModes,
    selectedProvider,
    selectedModel,
  ]);

  const isPanelBusy = busyAgentIds.size > 0 || busySessionKeys.size > 0;
  const canSend =
    !!selectedAgent &&
    !!selectedModel.trim() &&
    !isComposerBusy &&
    (draftMessage.trim().length > 0 || attachedImages.length > 0 || attachedFiles.length > 0);

  const setSessionBusy = useCallback((sessionKey: string, busy: boolean) => {
    if (!sessionKey) return;
    setBusySessionKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(sessionKey);
      else next.delete(sessionKey);
      busySessionKeysRef.current = next;
      return next;
    });
  }, []);

  const setAgentBusy = useCallback((agentId: string, busy: boolean) => {
    if (!agentId) return;
    setBusyAgentIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      busyAgentIdsRef.current = next;
      return next;
    });
  }, []);

  const trackStream = useCallback(
    (messageId: string, meta: StreamMeta) => {
      const sessionKey =
        meta.sessionKey ??
        buildPendingSessionKey(activeProjectKeyRef.current, meta.conversationId);
      streamMetaByMessageIdRef.current[messageId] = { ...meta, sessionKey };
      activeStreamMessageIdsBySessionRef.current[sessionKey] = messageId;

      const agentStreams =
        activeStreamMessageIdsByAgentRef.current[meta.agentId] ?? new Set<string>();
      agentStreams.add(messageId);
      activeStreamMessageIdsByAgentRef.current[meta.agentId] = agentStreams;

      setSessionBusy(sessionKey, true);
      setAgentBusy(meta.agentId, true);
    },
    [setSessionBusy, setAgentBusy]
  );

  // Stream control hook
  const {
    isStopRequested,
    consumeStopRequest,
    handleStopStreaming,
    clearTrackedStream,
  } = useAgentStreamControl({
    selectedAgentId: agent?.id ?? null,
    selectedSessionKey: selectedPendingSessionKey,
    activeStreamMessageIdsByAgentRef,
    activeStreamMessageIdsBySessionRef,
    streamMetaByMessageIdRef,
    busySessionKeysRef,
    streamFlushRef,
    setAgentBusy,
    setSessionBusy,
    setConversationState,
    setError,
    stopFailedText: t.errors.stopFailed,
  });

  // Agent init hook
  const handleActiveProjectPathResolved = useCallback(
    (resolvedPath: string) => {
      if (normalizeProjectPath(resolvedPath) === normalizeProjectPath(projectPath)) return;
      onProjectPathChange?.(resolvedPath);
    },
    [projectPath, onProjectPathChange]
  );

  useAgentInit({
    projectPath,
    loadErrorMessage: t.errors.loadAiConfigFailed,
    onSetAgent: setAgent,
    onSetConversationState: setConversationState,
    onSetActiveProjectKey: setActiveProjectKey,
    onSetIsInitializing: setIsInitializing,
    onSetError: setError,
    onActiveProjectPathResolved: onProjectPathChange ? handleActiveProjectPathResolved : undefined,
    skipProjectBootstrapRef,
  });

  useHydrateSubagentRuns(conversationState);

  useEffect(() => {
    if (isInitializing || !cbmGraphEnabled || !graphAutoIndexOnOpen || !projectPath?.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void scheduleCbmWorkspaceIndex(projectPath, {
        maxFiles: graphAutoIndexMaxFiles > 0 ? graphAutoIndexMaxFiles : undefined,
      }).then((result) => {
        if (isCbmSkippedTooLarge(result)) {
          showWarning(t.graph.projectTooLarge);
        }
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [cbmGraphEnabled, graphAutoIndexMaxFiles, graphAutoIndexOnOpen, isInitializing, projectPath, showWarning, t.graph.projectTooLarge]);

  useEffect(() => {
    if (isInitializing) return;
    let cancelled = false;
    void loadAllProjectThreadSummaries()
      .then((summaries) => {
        if (!cancelled) {
          setDiskThreadSummariesByProject(summaries);
        }
      })
      .catch((error) => {
        console.error('Failed to load project thread summaries:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isInitializing, projectPath, conversationState.conversations.length]);

  const refreshDiskThreadSummaries = useCallback(async () => {
    const summaries = await loadAllProjectThreadSummaries();
    setDiskThreadSummariesByProject(summaries);
  }, []);

  // Streaming queue hook
  const {
    enqueueStreamChunk,
    flushAllQueuedChunks,
    drainQueuedChunksFast,
    stopStreamChunkTimer,
    hasQueuedChunksForMessage,
  } = useAgentStreamingQueue({
    streamSpeed,
    selectedAgentIdRef,
    conversationStateRef,
    messagesContainerRef,
    isNearBottomRef,
    shouldSkipChunk: (item) => {
      if (isStopRequested(item.sessionKey)) return true;
      return !streamMetaByMessageIdRef.current[item.message_id];
    },
    onSetConversationState: setConversationState,
  });

  streamFlushRef.current = {
    flushAllQueuedChunks,
    drainQueuedChunksFast,
  };

  // Tool calls hook - assigns handleToolCallsRef.current
  useAgentToolCalls({
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
    onSetPendingChangesBySession: setPendingChangesBySession,
    onAskUserQuestion: handleAskUserQuestion,
    onExitPlanMode: handleExitPlanMode,
    onRequestApproval: requestApproval,
    onRuntimeReconciled: handleRuntimeReconciled,
    t,
  });

  // Stream events hook
  useAgentStreamEvents({
    streamSpeed,
    enqueueStreamChunk,
    flushAllQueuedChunks,
    drainQueuedChunksFast,
    stopStreamChunkTimer,
    hasQueuedChunksForMessage,
    getKnownToolNames: () => {
      const currentAgent = agentRef.current;
      const runtime = agentRuntimeRef.current;
      const provider = (runtime?.provider ??
        (selectedProvider === 'auto' ? currentAgent?.provider : selectedProvider) ??
        currentAgent?.provider ??
        'openai') as AIProvider;
      const tools = getProviderTools(provider, currentAgent?.id);
      return extractKnownToolNamesFromProviderTools(tools);
    },
    handleToolCallsRef,
    isStopRequested,
    clearTrackedStream,
    onSetConversationState: setConversationState,
    onSetError: setError,
    streamMetaByMessageIdRef,
    conversationStateRef,
    agentRuntimeRef,
  });

  // Conversation persistence hook
  const { lastSavedSnapshotByProjectRef, flushProjectStateNow, invalidatePendingProjectPersist } =
    useAgentConversationPersistence({
      conversationState,
      activeProjectKey,
      isInitializing,
    });

  const hydrateThreadSettings = useCallback(
    (settings: AgentThreadSettings | undefined) => {
      if (settings?.routingMode === 'auto') {
        threadSettingsRef.current = settings;
        if (settings.accessMode) {
          void updateAgentAccessMode(settings.accessMode);
        }
        if (settings.reasoningEffort) {
          void updateReasoningEffort(settings.reasoningEffort);
        }
        setSelectedProvider('auto');
        syncAgentRuntimeRef({ routingMode: 'auto' });
        return;
      }

      if (!settings) {
        if (selectedProvider === 'auto') {
          const autoSettings: AgentThreadSettings = {
            routingMode: 'auto',
            accessMode: agentAccessMode,
            reasoningEffort,
          };
          threadSettingsRef.current = autoSettings;
          syncAgentRuntimeRef({ routingMode: 'auto' });
          return;
        }
        threadSettingsRef.current = undefined;
      } else {
        threadSettingsRef.current = settings;
      }

      if (settings?.accessMode) {
        void updateAgentAccessMode(settings.accessMode);
      }
      if (settings?.reasoningEffort) {
        void updateReasoningEffort(settings.reasoningEffort);
      }

      let provider = (selectedAgent?.provider ?? 'openai') as AIProvider;
      let model = '';
      let profileId: string | undefined;

      if (settings?.provider) {
        provider = settings.provider as AIProvider;
        setSelectedProvider(provider);
      }
      if (settings?.profileId) {
        profileId = settings.profileId;
        setActiveProfileId(settings.profileId);
      }
      if (settings?.model) {
        model = settings.model;
      } else if (selectedAgent && !settings?.provider) {
        if (selectedAgent.provider) {
          provider = selectedAgent.provider;
          setSelectedProvider(provider);
        }
        const parsed = parseProviderAndModel(selectedAgent.model ?? '');
        model = parsed.model || selectedAgent.model || '';
        profileId = profileId ?? selectedAgent.profileId;
      }

      syncAgentRuntimeRef({ routingMode: 'manual' });
      void applyModelSelectionFromConfig(
        provider,
        model,
        profileId,
        resolveComparableAgentModel(selectedAgent?.model),
        profileId ? 'explicit' : 'infer'
      );
    },
    [applyModelSelectionFromConfig, selectedAgent, selectedProvider, agentAccessMode, reasoningEffort, syncAgentRuntimeRef, updateAgentAccessMode, updateReasoningEffort]
  );

  const collectCurrentThreadSettings = useCallback((): AgentThreadSettings | undefined => {
    const isAutoRouting = selectedProvider === 'auto';
    return {
      accessMode: agentAccessMode,
      reasoningEffort,
      routingMode: isAutoRouting ? 'auto' : 'manual',
      provider: isAutoRouting ? undefined : selectedProvider,
      model: isAutoRouting ? undefined : selectedModel,
      profileId: isAutoRouting ? undefined : activeProfileId || undefined,
    };
  }, [activeProfileId, agentAccessMode, reasoningEffort, selectedProvider, selectedModel]);

  const projectPaths = useMemo(() => {
    return collectProjectPathsFromState(
      conversationState,
      recentWorkspaces.map((workspace) => workspace.path),
      projectPath
    );
  }, [conversationState, recentWorkspaces, projectPath]);

  const threadManager = useAgentThreadManager({
    projectPath,
    projectPaths,
    branchName: projectBranchName,
    conversationState,
    activeProjectKey,
    diskThreadSummariesByProject,
    agent,
    conversationStateRef,
    onSetConversationState: setConversationState,
    onSetDraftMessage: setDraftMessage,
    onSetError: setError,
    onSetRenamingConversationId: setRenamingConversationId,
    onSetRenamingConversationTitle: setRenamingConversationTitle,
    renamingConversationId,
    renamingConversationTitle,
    lastSavedSnapshotByProjectRef,
    draftTextareaRef,
    onSetPendingChangesBySession: setPendingChangesBySession,
    draftMessage,
    onHydrateThreadSettings: hydrateThreadSettings,
    onPersistCurrentThreadSettings: collectCurrentThreadSettings,
    onSaveDraftForSession: saveDraftForSession,
    onLoadDraftForSession: loadDraftForSession,
    onClearSessionExtras: clearSessionExtras,
    onRefreshThreadSummaries: refreshDiskThreadSummaries,
    onInvalidatePendingProjectPersist: invalidatePendingProjectPersist,
  });

  const {
    threadsByProject,
    selectedThreadId: selectedThreadIdFromManager,
    pendingDeleteThread,
    isDeletingThread,
    handleNewThread,
    handleSelectThread,
    requestDeleteThread,
    confirmDeleteThread,
    startRenameThread,
    cancelRenameThread,
    commitRenameThread,
    setPendingDeleteThread,
    updateCurrentThreadSettings,
    persistCurrentThreadBeforeSwitch,
  } = threadManager;

  const lastDraftHydrationKeyRef = useRef('');

  useEffect(() => {
    if (!extrasLoaded || !activeProjectKey) return;
    const hydrationKey = selectedThreadIdFromManager
      ? `thread::${activeProjectKey}::${selectedThreadIdFromManager}`
      : `compose::${activeProjectKey}`;
    if (lastDraftHydrationKeyRef.current === hydrationKey) return;
    lastDraftHydrationKeyRef.current = hydrationKey;
    const sessionKey = selectedThreadIdFromManager
      ? buildPendingSessionKey(activeProjectKey, selectedThreadIdFromManager)
      : buildComposeDraftSessionKey(activeProjectKey);
    const savedDraft = loadDraftForSession(sessionKey);
    setDraftMessage(savedDraft);
  }, [
    extrasLoaded,
    activeProjectKey,
    selectedThreadIdFromManager,
    loadDraftForSession,
  ]);

  useEffect(() => {
    if (!extrasLoaded || !activeProjectKey) return;
    const sessionKey = selectedThreadIdFromManager
      ? buildPendingSessionKey(activeProjectKey, selectedThreadIdFromManager)
      : buildComposeDraftSessionKey(activeProjectKey);
    saveDraftForSession(sessionKey, draftMessage);
  }, [
    draftMessage,
    activeProjectKey,
    selectedThreadIdFromManager,
    extrasLoaded,
    saveDraftForSession,
  ]);

  const streamingSessionKeys = busySessionKeys;

  const streamingProjectKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [projectKey, threads] of Object.entries(threadsByProject)) {
      if (threads.some((thread) => streamingSessionKeys.has(thread.sessionKey))) {
        keys.add(projectKey);
      }
    }
    return keys;
  }, [threadsByProject, streamingSessionKeys]);

  const projectTreeState = useAgentProjectTreeState({
    projectPaths,
    activeProjectPath: projectPath,
    selectedThreadProjectPath: selectedConversation?.projectPath,
    streamingProjectKeys,
  });

  useEffect(() => {
    if (selectedProvider === 'auto') {
      agentRuntimeRef.current = {
        ...agentRuntimeRef.current,
        routingMode: 'auto',
      };
      return;
    }

    agentRuntimeRef.current = {
      provider: selectedProvider,
      model: selectedModel || selectedAgent?.model || '',
      profileId: activeProfileId || selectedAgent?.profileId || undefined,
      routingMode: 'manual',
    };
  }, [
    selectedProvider,
    selectedModel,
    activeProfileId,
    selectedAgent?.provider,
    selectedAgent?.model,
    selectedAgent?.profileId,
  ]);

  useEffect(() => {
    const settings = collectCurrentThreadSettings();
    if (!settings) return;
    threadSettingsRef.current = settings;
    if (!selectedConversationId) return;
    const conversation = conversationState.conversations.find(
      (item) => item.id === selectedConversationId
    );
    const existing = conversation?.threadSettings;
    if (
      existing?.accessMode === settings.accessMode &&
      existing?.reasoningEffort === settings.reasoningEffort &&
      existing?.routingMode === settings.routingMode &&
      existing?.provider === settings.provider &&
      existing?.model === settings.model &&
      existing?.profileId === settings.profileId
    ) {
      return;
    }
    updateCurrentThreadSettings(settings);
  }, [
    agentAccessMode,
    reasoningEffort,
    selectedProvider,
    selectedModel,
    activeProfileId,
    selectedConversationId,
    collectCurrentThreadSettings,
    updateCurrentThreadSettings,
    conversationState,
  ]);

  // Pending changes hook
  const {
    acceptPendingChange,
    acceptAllPendingChanges,
    rejectPendingChange,
    rejectAllPendingChanges,
  } = useAgentPendingChanges({
    projectPathRef,
    activeProjectKeyRef,
    previewKey: agent?.id ?? null,
    onShowWarning: showWarning,
    onShowInfo: showInfo,
    onSetConversationState: setConversationState,
    onSetPreviewOpenByAgent: setPreviewOpenByAgent,
    onSetPendingChangesBySession: setPendingChangesBySession,
    pendingChangesBySession,
    previewOpenByAgent,
    conversationStateRef,
  });

  useEffect(() => {
    onFilesChangedRef.current = onFilesChanged;
  }, [onFilesChanged]);

  useEffect(() => {
    selectedAgentIdRef.current = agent?.id ?? null;
  }, [agent?.id]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    conversationStateRef.current = conversationState;
  }, [conversationState]);

  useEffect(() => {
    activeProjectKeyRef.current = activeProjectKey;
  }, [activeProjectKey]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<AgentBusyChangeDetail>(AGENT_BUSY_CHANGE_EVENT, {
        detail: {
          panelId: panelIdRef.current,
          busy: isPanelBusy,
        },
      })
    );
  }, [isPanelBusy]);

  useEffect(() => {
    const currentPanelId = panelIdRef.current;
    return () => {
      window.dispatchEvent(
        new CustomEvent<AgentBusyChangeDetail>(AGENT_BUSY_CHANGE_EVENT, {
          detail: {
            panelId: currentPanelId,
            busy: false,
          },
        })
      );
    };
  }, []);

  // 只在切换 agent 或会话时滚动到底部，不在流式输出时强制跟随
  useEffect(() => {
    return;
    if (!messagesContainerRef.current) return;
    // Legacy effect left intentionally inert.
    void isNearBottomRef.current;
    // 使用 setTimeout 确保在 selectedMessages 渲染后再滚动
    const timer = setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [agent?.id, selectedConversationId, selectedMessages.length]);

  useEffect(() => {
    setError(null);
    setRenamingConversationId(null);
    setRenamingConversationTitle('');
  }, [agent?.id]);

  // Restore the saved scroll position for the selected session instead of
  // forcing the message list to jump to the bottom on agent/session switch.
  useEffect(() => {
    if (!messagesContainerRef.current) return;

    const timer = window.setTimeout(() => {
      if (!messagesContainerRef.current) return;

      const nextScrollTop =
        activeScrollSessionKey != null
          ? (scrollTopBySessionRef.current[activeScrollSessionKey] ?? 0)
          : 0;

      messagesContainerRef.current.scrollTop = nextScrollTop;

      const el = messagesContainerRef.current;
      isNearBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeScrollSessionKey]);

  // Only auto-scroll when the active conversation receives more messages and
  // the user was already near the bottom. Switching agent/session should not
  // force the viewport to jump.
  useEffect(() => {
    const previousSnapshot = previousAutoScrollSnapshotRef.current;
    previousAutoScrollSnapshotRef.current = {
      agentId: agent?.id ?? null,
      conversationId: selectedConversationId,
      messageCount: selectedMessages.length,
    };

    if (!messagesContainerRef.current) return;

    const shouldAutoScroll =
      previousSnapshot.agentId === (agent?.id ?? null) &&
      previousSnapshot.conversationId === selectedConversationId &&
      selectedMessages.length > previousSnapshot.messageCount &&
      isNearBottomRef.current;

    if (!shouldAutoScroll) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (messagesContainerRef.current) {
        // Legacy switch-scroll disabled. Message-growth auto-scroll is handled
        // by the effect below to avoid layout jumps when switching agents.
        void messagesContainerRef.current;
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [agent?.id, selectedConversationId, selectedMessages.length]);

  useEffect(() => {
    const previousAgentId = previousContentAgentIdRef.current;
    previousContentAgentIdRef.current = agent?.id ?? null;

    if (
      !previousAgentId ||
      !agent?.id ||
      previousAgentId === agent.id
    ) {
      setIsAgentContentEntering(false);
      return;
    }

    setIsAgentContentEntering(true);
    if (contentEnterTimerRef.current) {
      window.clearTimeout(contentEnterTimerRef.current);
    }
    contentEnterTimerRef.current = window.setTimeout(() => {
      setIsAgentContentEntering(false);
      contentEnterTimerRef.current = null;
    }, 180);
  }, [agent?.id]);

  useEffect(() => {
    return () => {
      if (contentEnterTimerRef.current) {
        window.clearTimeout(contentEnterTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const didSwitchAgent = previousSelectedAgentIdRef.current !== (agent?.id ?? null);
    previousSelectedAgentIdRef.current = agent?.id ?? null;

    if (isEmptyConversationState) {
      setIsEmptyStateVisible(true);
      setIsEmptyStateExiting(false);
      return;
    }

    if (!isEmptyStateVisible) {
      return;
    }

    if (didSwitchAgent) {
      setIsEmptyStateVisible(false);
      setIsEmptyStateExiting(false);
      return;
    }

    setIsEmptyStateExiting(true);
    const timer = window.setTimeout(() => {
      setIsEmptyStateVisible(false);
      setIsEmptyStateExiting(false);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [isEmptyConversationState, isEmptyStateVisible, agent?.id]);

  useEffect(() => {
    return () => {
      const messageIds = Object.keys(streamMetaByMessageIdRef.current);
      for (const messageId of messageIds) {
        void invoke('cancel_ai_chat', { messageId }).catch(() => {
          // ignore cleanup cancel errors
        });
      }
      activeStreamMessageIdsByAgentRef.current = {};
      activeStreamMessageIdsBySessionRef.current = {};
      streamMetaByMessageIdRef.current = {};
      busyAgentIdsRef.current = new Set();
      busySessionKeysRef.current = new Set();
    };
  }, []);


  const handleUserMessageSent = useCallback(() => {
    setShowScrollButton(false);
    scheduleScrollContainerToBottom(messagesContainerRef, {
      markNearBottom: isNearBottomRef,
    });
  }, []);

  // Send message hook
  const { sendMessage, resendFromUserMessage } = useAgentSendMessage({
    draftMessage,
    selectedAgentId: agent?.id ?? null,
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
    onRuntimeReconciled: handleRuntimeReconciled,
    onUserMessageSent: handleUserMessageSent,
    getCurrentThreadSettings: collectCurrentThreadSettings,
    sendFailedText: t.errors.sendFailed,
    visionUnsupportedError: VISION_UNSUPPORTED_ERROR,
    stopStreaming: handleStopStreaming,
    onSetPendingChangesBySession: setPendingChangesBySession,
    onFilesChanged: (paths) => onFilesChangedRef.current?.(paths),
  });

  const handleSendCurrentMessage = useCallback(async () => {
    await sendMessage();
  }, [sendMessage]);
  handleSendCurrentMessageRef.current = handleSendCurrentMessage;

  const handleResendFromUserMessage = useCallback(
    async (messageId: string, newText: string) => {
      await resendFromUserMessage(messageId, newText);
    },
    [resendFromUserMessage]
  );

  const handleSwitchProject = useCallback(
    async (
      path: string,
      preferredThreadId?: string,
      options?: {
        preferCompose?: boolean;
      }
    ) => {
      persistCurrentThreadBeforeSwitch();
      await flushProjectStateNow(activeProjectKey);
      if (agent) {
        try {
          const { projectKey, state } = await loadProjectConversationStateFromDisk(path, agent);
          let nextState = applyPreferredThreadSelection(state, path, preferredThreadId);
          if (options?.preferCompose) {
            const projectKeyPath = normalizeProjectPath(path);
            nextState = {
              ...nextState,
              selectedConversationId: null,
              selectedConversationIdByProject: {
                ...(nextState.selectedConversationIdByProject ?? {}),
                [projectKeyPath]: null,
              },
            };
          }
          const persistable = toProjectConversationStateForPersistence(nextState);
          await saveProjectState(projectKey, persistable);
          seedProjectPersistenceSnapshot(projectKey, nextState);
          const resolvedThreadId = resolveSelectedThreadId(nextState, path);
          const sessionKey = resolveDraftSessionKey(projectKey, resolvedThreadId);
          const nextDraft = loadDraftForSession(sessionKey);
          lastDraftHydrationKeyRef.current = resolvedThreadId
            ? `thread::${projectKey}::${resolvedThreadId}`
            : `compose::${projectKey}`;
          setActiveProjectKey(projectKey);
          setConversationState(nextState);
          setDraftMessage(nextDraft);
          await touchProjectIndex(path);
          if (cbmGraphEnabled && graphAutoIndexOnOpen) {
            void scheduleCbmWorkspaceIndex(path, {
              maxFiles: graphAutoIndexMaxFiles > 0 ? graphAutoIndexMaxFiles : undefined,
            }).then((result) => {
              if (isCbmSkippedTooLarge(result)) {
                showWarning(t.graph.projectTooLarge);
              }
            });
          }
          const summaries = await loadAllProjectThreadSummaries();
          setDiskThreadSummariesByProject(summaries);
          skipProjectBootstrapRef.current = true;
        } catch (error) {
          console.error('Failed to load project conversation state:', error);
        }
      }
      if (onProjectPathChange) {
        onProjectPathChange(path);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set('window', 'agent');
      params.set('projectPath', path);
      window.location.search = params.toString();
    },
    [activeProjectKey, agent, cbmGraphEnabled, flushProjectStateNow, graphAutoIndexMaxFiles, graphAutoIndexOnOpen, loadDraftForSession, onProjectPathChange, persistCurrentThreadBeforeSwitch, showWarning, t.graph.projectTooLarge]
  );

  const handleSelectThreadInProject = useCallback(
    (targetPath: string, threadId: string) => {
      if (normalizeProjectPath(targetPath) !== normalizeProjectPath(projectPath)) {
        void handleSwitchProject(targetPath, threadId);
        return;
      }
      handleSelectThread(threadId, targetPath);
    },
    [projectPath, handleSwitchProject, handleSelectThread]
  );

  useAutomationEvent({
    onSelectThread: (threadId, targetProjectPath) => {
      if (
        targetProjectPath &&
        normalizeProjectPath(targetProjectPath) !== normalizeProjectPath(projectPath)
      ) {
        void handleSelectThreadInProject(targetProjectPath, threadId);
        return;
      }
      handleSelectThread(threadId, targetProjectPath);
    },
    sendMessage,
    selectedAgentId: agent?.id ?? null,
  });

  const handleNewThreadInProject = useCallback(
    (targetPath: string) => {
      const previousPath = projectPath;
      projectTreeState.expandProject(targetPath);
      if (normalizeProjectPath(targetPath) !== normalizeProjectPath(previousPath)) {
        projectTreeState.expandProject(previousPath);
        void handleSwitchProject(targetPath, undefined, { preferCompose: true });
        return;
      }
      handleNewThread(targetPath);
    },
    [projectPath, handleSwitchProject, handleNewThread, projectTreeState]
  );

  const handleAddProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== 'string' || !selected.trim()) return;
      const name = selected.split(/[\\/]/).pop() || selected;
      await touchRecentWorkspace(selected, name);
      projectTreeState.expandProject(selected);
      handleSwitchProject(selected);
    } catch (error) {
      console.error('Failed to add project:', error);
    }
  }, [touchRecentWorkspace, projectTreeState, handleSwitchProject]);

  const pendingDeleteProjectThreadCount = useMemo(() => {
    if (!pendingDeleteProject) return 0;
    const key = normalizeProjectPath(pendingDeleteProject.path);
    return threadsByProject[key]?.length ?? 0;
  }, [pendingDeleteProject, threadsByProject]);

  const confirmDeleteProject = useCallback(async () => {
    if (!pendingDeleteProject || isDeletingProject) return;
    setIsDeletingProject(true);
    try {
      const deletingActiveProject =
        normalizeProjectPath(pendingDeleteProject.path) === normalizeProjectPath(projectPath);
      if (deletingActiveProject) {
        persistCurrentThreadBeforeSwitch();
        await flushProjectStateNow(activeProjectKey);
      }

      await deleteProjectFromWorkspace({
        projectPath: pendingDeleteProject.path,
        currentProjectPath: projectPath,
        removeRecentWorkspace,
        clearSessionExtrasForProject,
        invalidateProjectSnapshot: (projectKey) => {
          delete lastSavedSnapshotByProjectRef.current[projectKey];
          invalidatePendingProjectPersist(projectKey);
        },
        onResetActiveProject: () => {
          setConversationState(emptyProjectConversationState());
          setDraftMessage('');
          setActiveProjectKey('');
          lastDraftHydrationKeyRef.current = '';
        },
        onProjectPathChange,
        onCbmDeleteFailed: () => {
          showWarning(t.graph.indexDeleteFailed);
        },
        enableCodeGraph: cbmGraphEnabled,
      });

      await refreshDiskThreadSummaries();
      setPendingDeleteProject(null);
    } catch (error) {
      console.error('Failed to delete project from workspace:', error);
      showError(t.agent.nav.deleteProjectFailed);
    } finally {
      setIsDeletingProject(false);
    }
  }, [
    activeProjectKey,
    flushProjectStateNow,
    invalidatePendingProjectPersist,
    isDeletingProject,
    lastSavedSnapshotByProjectRef,
    onProjectPathChange,
    pendingDeleteProject,
    persistCurrentThreadBeforeSwitch,
    projectPath,
    refreshDiskThreadSummaries,
    removeRecentWorkspace,
    clearSessionExtrasForProject,
    showError,
    t.agent.nav.deleteProjectFailed,
  ]);

  useEffect(() => {
    if (!selectedAgent) {
      lastModelSyncAgentIdRef.current = null;
      return;
    }
    if (lastModelSyncAgentIdRef.current === selectedAgent.id) return;
    lastModelSyncAgentIdRef.current = selectedAgent.id;

    const parsed = parseProviderAndModel(selectedAgent.model ?? '');
    const provider = (selectedAgent.provider ?? parsed.provider ?? 'openai') as AIProvider;
    setSelectedProvider(provider);
    const model = parsed.model || selectedAgent.model || '';
    setSelectedModel(model);
    if (selectedAgent.profileId) {
      setActiveProfileId(selectedAgent.profileId);
    }
    void applyModelSelectionFromConfig(
      provider,
      model,
      selectedAgent.profileId,
      resolveComparableAgentModel(selectedAgent.model),
      selectedAgent.profileId ? 'explicit' : 'infer'
    );
  }, [applyModelSelectionFromConfig, selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    if (selectedProvider === 'auto') return;
    if (
      selectedAgent.provider === selectedProvider &&
      agentModelSelectionsMatch(selectedAgent.model, selectedModel) &&
      (selectedAgent.profileId ?? '') === (activeProfileId || '')
    ) {
      return;
    }
    if (!selectedModel) return;
    void saveAgent({
      ...selectedAgent,
      provider: selectedProvider,
      model: selectedModel,
      profileId: activeProfileId || undefined,
    }).then((updated) => {
      setAgent(updated);
    });
  }, [
    selectedAgent?.id,
    selectedAgent?.model,
    selectedAgent?.provider,
    selectedAgent?.profileId,
    selectedProvider,
    selectedModel,
    activeProfileId,
  ]);

  useEffect(() => {
    if (isInitializing || !agent) return;
    const hydrationKey = `${activeProjectKey}::${selectedThreadIdFromManager ?? 'compose'}`;
    if (lastThreadSettingsHydrationKeyRef.current === hydrationKey) return;

    if (selectedThreadIdFromManager) {
      const conversation = conversationState.conversations.find(
        (conversation) => conversation.id === selectedThreadIdFromManager
      );
      if (!conversation) return;
      hydrateThreadSettings(conversation.threadSettings);
      lastThreadSettingsHydrationKeyRef.current = hydrationKey;
      return;
    }

    hydrateThreadSettings(undefined);
    lastThreadSettingsHydrationKeyRef.current = hydrationKey;
  }, [
    isInitializing,
    agent,
    activeProjectKey,
    selectedThreadIdFromManager,
    conversationState,
    hydrateThreadSettings,
  ]);

  const selectedProfileName = useMemo(() => {
    const profile = availableProfiles.find((item) => item.id === activeProfileId);
    if (profile?.name) {
      return profile.name;
    }
    if (!activeProfileId && availableProfiles.length === 1 && !availableProfiles[0]?.name) {
      return t.common.defaultConfig;
    }
    return activeProfileId;
  }, [activeProfileId, availableProfiles, t.common.defaultConfig]);

  const composerNode = (
    <AgentComposer
      inputValue={draftMessage}
      setInputValue={setDraftMessage}
      isLoading={isComposerBusy}
      isStopping={false}
      canSend={canSend}
      showStop={isComposerBusy}
      disabled={!selectedAgent || isComposerBusy}
      isDragOver={isDragOver}
      attachedFiles={attachedFiles}
      attachedImages={attachedImages}
      textareaRef={draftTextareaRef}
      inputCardRef={inputCardRef}
      imageInputRef={imageInputRef}
      handleDragOver={handleDragOver}
      handleDragLeave={handleDragLeave}
      handleDrop={handleDrop}
      handleInputPaste={handleInputPaste}
      removeFileFromContext={removeFileFromContext}
      removeImageFromContext={handleRemoveImage}
      handleSend={handleSendCurrentMessage}
      handleStop={handleStopStreaming}
      handleImageInputChange={handleImageInputChange}
      selectedProvider={selectedProvider}
      onSelectProvider={handleSelectProvider}
      selectedProfileId={activeProfileId}
      selectedProfileName={selectedProfileName}
      availableProfiles={availableProfiles}
      onSelectProfile={handleSelectProfile}
      selectedModel={selectedModel}
      onSelectModel={handleSelectModel}
      availableModels={availableModels}
      safeTotalTokens={totalTokens}
      ctxPercent={tokenPercentage}
      maxContextTokens={currentBudget}
      centered={isEmptyConversationState}
      skillsCount={skillsCount}
      mcpCount={mcpTools.length}
      skillNames={skillNames}
      mcpToolNames={mcpToolNames}
      agentMode={agent?.id ? (agentModes[agent.id] ?? 'always-allow') : 'always-allow'}
      onAgentModeChange={handleAgentModeChange}
    />
  );

  const contextBarNode = (
    <AgentContextBar
      projectPath={projectPath}
      projectName={projectName}
      onSwitchProject={handleSwitchProject}
      centered={isEmptyConversationState}
    />
  );

  const handleScrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    cancelSmoothScrollRef.current?.();
    setShowScrollButton(false);

    cancelSmoothScrollRef.current = smoothScrollToBottom(container, {
      onComplete: () => {
        cancelSmoothScrollRef.current = null;
        isNearBottomRef.current = true;
        if (activeScrollSessionKey) {
          scrollTopBySessionRef.current[activeScrollSessionKey] = container.scrollTop;
        }
      },
    });
  }, [activeScrollSessionKey]);

  const handleMessagesScroll = useCallback(() => {
    if (!activeScrollSessionKey || !messagesContainerRef.current) return;
    scrollTopBySessionRef.current[activeScrollSessionKey] = messagesContainerRef.current.scrollTop;
    const el = messagesContainerRef.current;
    isNearBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    setShowScrollButton(!isNearBottomRef.current);
    scheduleUpdate();
  }, [activeScrollSessionKey, scheduleUpdate]);

  const handleToggleThinking = useCallback((messageId: string) => {
    setExpandedThinkingIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      cancelSmoothScrollRef.current?.();
      cancelSmoothScrollRef.current = null;
    };
  }, []);

  return (
    <div className={styles.container} style={desktopShellStyle}>
      <style>
        {`.agent-msg-bubble { overflow-y: auto; }
          .agent-msg-bubble::-webkit-scrollbar { width: 10px; background: transparent; }
          .agent-msg-bubble::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, var(--text-secondary) 35%, transparent);
            border-radius: 6px;
          }`}
      </style>

      <AgentNavSidebar
        projectPath={projectPath}
        projectName={projectName}
        recentWorkspaces={recentWorkspaces}
        threadsByProject={threadsByProject}
        selectedThreadId={selectedThreadIdFromManager}
        streamingSessionKeys={streamingSessionKeys}
        hideEmptyProjects={projectTreeState.hideEmptyProjects}
        isProjectExpanded={projectTreeState.isExpanded}
        onToggleProjectExpanded={projectTreeState.toggleExpanded}
        onToggleHideEmptyProjects={projectTreeState.toggleHideEmptyProjects}
        onAddProject={() => void handleAddProject()}
        renamingThreadId={renamingConversationId}
        renamingTitle={renamingConversationTitle}
        onRenamingTitleChange={setRenamingConversationTitle}
        onNewThread={() => handleNewThread(projectPath)}
        onAutomation={() => setIsAutomationsPanelOpen((prev) => !prev)}
        onSelectThreadInProject={handleSelectThreadInProject}
        onNewThreadInProject={handleNewThreadInProject}
        onStartRenameThread={startRenameThread}
        onCommitRenameThread={commitRenameThread}
        onCancelRenameThread={cancelRenameThread}
        onRequestDeleteThread={requestDeleteThread}
        onRequestDeleteProject={setPendingDeleteProject}
        sidebarMode={sidebarMode}
        settingsSection={settingsSection}
        onSettingsSectionChange={setSettingsSection}
        onOpenSettings={() => {
          setIsAutomationsPanelOpen(false);
          setSidebarMode('settings');
        }}
        onExitSettings={() => setSidebarMode('workspace')}
      />

      <AgentProjectDeleteDialog
        pendingProject={pendingDeleteProject}
        threadCount={pendingDeleteProjectThreadCount}
        isDeleting={isDeletingProject}
        onCancel={() => setPendingDeleteProject(null)}
        onConfirm={() => void confirmDeleteProject()}
      />

      <AgentThreadDeleteDialog
        pendingThread={pendingDeleteThread}
        isDeleting={isDeletingThread}
        onCancel={() => setPendingDeleteThread(null)}
        onConfirm={confirmDeleteThread}
      />

      <main style={sessionColumnStyle} data-testid="agent-session-column">
        {sidebarMode === 'settings' ? (
          <div className={styles.agentContentFrame}>
            <div className={settingsViewStyles.main}>
              <div className={styles.contentColumn}>
                <AgentContent variant="panel" section={settingsSection} />
              </div>
            </div>
          </div>
        ) : isAutomationsPanelOpen ? (
          <AutomationsPanel
            projectPath={projectPath}
            onClose={() => setIsAutomationsPanelOpen(false)}
          />
        ) : isInitializing ? (
          <div className={styles.initializationLoader}>
            <div className={styles.loaderSpinnerWrapper}>
              <div className={styles.loaderSpinnerGlow} />
              <svg className={styles.loaderSpinner} viewBox="0 0 50 50">
                <circle
                  className={styles.loaderSpinnerPath}
                  cx="25"
                  cy="25"
                  r="20"
                  fill="none"
                  strokeWidth="4.5"
                />
              </svg>
              <div className={styles.loaderLogo}>✦</div>
            </div>
            <div className={styles.loaderText}>{t.agent.agentLoading}</div>
            <div className={styles.loaderSubtext}>
              {language.startsWith('zh') ? '正在配置安全沙箱与运行环境...' : 'Configuring sandbox environment and runtime connection...'}
            </div>
          </div>
        ) : !selectedAgent ? (
          <div className={styles.messagesEmptyHint}>{t.agent.noAgent}</div>
        ) : isEmptyConversationState ? (
          <AgentWelcomeState
            projectName={projectName}
            composer={
              <ComposerQuestionAnchor
                questions={pendingQuestions}
                onSubmit={handleSubmitPendingQuestions}
                onCancel={handleCancelPendingQuestions}
              >
                {composerNode}
              </ComposerQuestionAnchor>
            }
            contextBar={contextBarNode}
            exiting={isEmptyStateExiting}
          />
        ) : (
          <div className={styles.agentContentFrame}>
            <div className={styles.contentTrack}>
              <div className={styles.messagesWrap}>
                <div
                  ref={messagesContainerRef}
                  className={styles.messagesScrollHost}
                  onScroll={handleMessagesScroll}
                >
                  <div
                    className={`${styles.messagesScrollSurface} ${isAgentContentEntering ? styles.messagesContainerEntering : ''}`}
                  >
                    <div className={styles.contentColumn}>
                      {selectedMessages.length === 0 ? (
                        <div className={styles.messagesEmptyHint}>{t.agent.sendFirstTask}</div>
                      ) : (
                        <AgentMessageList
                          ref={messageListRef}
                          messages={selectedMessages}
                          expandedThinkingIds={expandedThinkingIds}
                          thinkingBlockAutoExpand={thinkingBlockAutoExpand}
                          streamingContinuingLabel={t.agent.streamingContinuing}
                          onToggleThinking={handleToggleThinking}
                          messagesContainerRef={messagesContainerRef}
                          onUserMessageLayout={handleUserMessageLayout}
                          getLayoutCache={getLayoutCache}
                          onApproveTool={approve}
                          onRejectTool={reject}
                          onResendFromUserMessage={handleResendFromUserMessage}
                          planSlot={
                            selectedConversationId && agentPlanVisible ? (
                              <PlanDocumentPanel
                                conversationId={selectedConversationId}
                                variant="inline"
                                autoOpenInEditor={false}
                                forceExpand={
                                  planReviewConversationId === selectedConversationId
                                }
                                onAccept={(planDoc) => {
                                  settleExitPlanReview(selectedConversationId, planDoc);
                                }}
                              />
                            ) : null
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>

                <MessageAnchorRail
                  messages={selectedMessages}
                  scrollContainerRef={messagesContainerRef}
                  getLayoutCache={getLayoutCache}
                  activeMessageId={pinnedMessage?.id}
                />

                {pinnedMessage && (
                  <div className={styles.userMessageStickyOverlay}>
                    <UserMessageStickyBar
                      message={pinnedMessage}
                      onJump={handleJumpToPinnedUserMessage}
                    />
                  </div>
                )}

                {showScrollButton && (
                  <ScrollToBottomButton
                    onClick={handleScrollToBottom}
                    title={language.startsWith('zh') ? '滚动到底部' : 'Scroll to bottom'}
                  />
                )}

                <ChangeCountCapsule
                  pendingChanges={selectedPendingChanges}
                  onOpenReview={() => setChangeReviewCollapsed(false)}
                />
                <BgTaskBadge />
              </div>

              <div className={styles.composerDock}>
                <div className={styles.contentColumn}>
                  <ComposerQuestionAnchor
                    questions={pendingQuestions}
                    onSubmit={handleSubmitPendingQuestions}
                    onCancel={handleCancelPendingQuestions}
                  >
                    <TodoListBar conversationId={selectedConversationId || ''} />
                    {composerNode}
                  </ComposerQuestionAnchor>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      <ChangeReviewPanel
        projectPath={projectPath}
        pendingChanges={selectedPendingChanges}
        checkpoints={sessionCheckpoints}
        restoringCheckpointId={restoringCheckpointId}
        collapsed={changeReviewCollapsed}
        onToggleCollapsed={() => setChangeReviewCollapsed((prev) => !prev)}
        onAccept={acceptPendingChange}
        onDiscard={async (change) => {
          await rejectPendingChange(change);
        }}
        onAcceptAll={acceptAllPendingChanges}
        onDiscardAll={async (changes) => {
          await rejectAllPendingChanges(changes);
        }}
        onRestoreCheckpoint={handleRestoreCheckpoint}
      />

      {error && (
        <div className={styles.errorToast} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
