import { useCallback, useMemo, useState } from 'react';
import type {
  AgentConversation,
  AgentConversationState,
  AgentThreadSettings,
} from '../../../types/chat';
import type { ProjectThreadSummary } from '../../../utils/agentPersistence';
import {
  filterThreadsByProject,
  resolveSelectedThreadId,
  buildComposeDraftSessionKey,
  resolveDraftSessionKey,
  conversationToThreadListItem,
  groupThreadsByProject,
  normalizeProjectPath,
  type AgentThreadListItem,
} from '../utils';
import { useAgentConversations, type UseAgentConversationsOptions } from './useAgentConversations';

export type { AgentThreadListItem };

export interface UseAgentThreadManagerOptions extends Omit<
  UseAgentConversationsOptions,
  'projectPath'
> {
  projectPath: string;
  projectPaths: string[];
  branchName: string | null;
  conversationState: AgentConversationState;
  diskThreadSummariesByProject?: Record<string, ProjectThreadSummary[]>;
  onHydrateThreadSettings: (settings: AgentThreadSettings | undefined) => void;
  onPersistCurrentThreadSettings: () => AgentThreadSettings | undefined;
  onSaveDraftForSession: (sessionKey: string, draft: string) => void;
  onLoadDraftForSession: (sessionKey: string) => string;
  onClearSessionExtras?: (sessionKey: string) => void;
  draftMessage: string;
}

export function useAgentThreadManager(options: UseAgentThreadManagerOptions) {
  const {
    projectPath,
    projectPaths,
    branchName,
    conversationState,
    activeProjectKey,
    diskThreadSummariesByProject,
    onHydrateThreadSettings,
    onPersistCurrentThreadSettings,
    onSaveDraftForSession,
    onLoadDraftForSession,
    onClearSessionExtras,
    draftMessage,
    ...conversationOptions
  } = options;

  const [pendingDeleteThread, setPendingDeleteThread] = useState<AgentThreadListItem | null>(null);
  const [isDeletingThread, setIsDeletingThread] = useState(false);

  const { onSetConversationState, onSetDraftMessage, ...conversationRest } = conversationOptions;

  const conversationApi = useAgentConversations({
    ...conversationRest,
    onSetConversationState,
    onSetDraftMessage,
    projectPath,
    activeProjectKey,
    onClearSessionExtras,
  });

  const threadsForProject = useMemo(
    () => filterThreadsByProject(conversationState, projectPath),
    [conversationState, projectPath]
  );

  const selectedThreadId = useMemo(
    () => resolveSelectedThreadId(conversationState, projectPath),
    [conversationState, projectPath]
  );

  const threadListItems = useMemo((): AgentThreadListItem[] => {
    return threadsForProject.map((conversation) =>
      conversationToThreadListItem(conversation, activeProjectKey, branchName)
    );
  }, [threadsForProject, branchName, activeProjectKey]);

  const projectKeysByPath = useMemo(() => {
    const map: Record<string, string> = {};
    const activePathKey = normalizeProjectPath(projectPath);
    if (activeProjectKey && activePathKey) {
      map[activePathKey] = activeProjectKey;
    }
    if (diskThreadSummariesByProject) {
      for (const [pathKey, summaries] of Object.entries(diskThreadSummariesByProject)) {
        const summaryKey = summaries[0]?.projectKey;
        if (summaryKey) {
          map[pathKey] = summaryKey;
        }
      }
    }
    return map;
  }, [projectPath, activeProjectKey, diskThreadSummariesByProject]);

  const threadsByProject = useMemo(() => {
    const grouped = groupThreadsByProject(
      conversationState,
      projectPaths,
      projectKeysByPath,
      branchName
    );

    if (!diskThreadSummariesByProject) {
      return grouped;
    }

    for (const [pathKey, summaries] of Object.entries(diskThreadSummariesByProject)) {
      if (grouped[pathKey]?.length) continue;
      grouped[pathKey] = summaries.map((summary) =>
        conversationToThreadListItem(
          {
            id: summary.id,
            title: summary.title,
            projectPath: summary.projectPath,
            updatedAt: summary.updatedAt ?? 0,
            createdAt: summary.updatedAt ?? 0,
            messages: [],
            previewHistory: [],
            currentPreviewIndex: 0,
          },
          summary.projectKey,
          branchName
        )
      );
    }

    return grouped;
  }, [
    conversationState,
    projectPaths,
    projectKeysByPath,
    branchName,
    diskThreadSummariesByProject,
  ]);

  const hydrateThread = useCallback(
    (conversation: AgentConversation | undefined) => {
      onHydrateThreadSettings(conversation?.threadSettings);
      if (!activeProjectKey) {
        onSetDraftMessage('');
        return;
      }
      const sessionKey = conversation
        ? resolveDraftSessionKey(activeProjectKey, conversation.id)
        : buildComposeDraftSessionKey(activeProjectKey);
      onSetDraftMessage(onLoadDraftForSession(sessionKey));
    },
    [onHydrateThreadSettings, onLoadDraftForSession, onSetDraftMessage, activeProjectKey]
  );

  const persistCurrentThreadBeforeSwitch = useCallback(() => {
    if (!activeProjectKey) return;
    const sessionKey = resolveDraftSessionKey(activeProjectKey, selectedThreadId);
    onSaveDraftForSession(sessionKey, draftMessage);
    if (!selectedThreadId) return;
    const settings = onPersistCurrentThreadSettings();
    if (!settings) return;
    onSetConversationState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((conversation) =>
        conversation.id === selectedThreadId
          ? { ...conversation, threadSettings: settings }
          : conversation
      ),
    }));
  }, [
    activeProjectKey,
    selectedThreadId,
    draftMessage,
    onSaveDraftForSession,
    onPersistCurrentThreadSettings,
    onSetConversationState,
  ]);

  const handleSelectThread = useCallback(
    (conversationId: string, targetProjectPath?: string) => {
      persistCurrentThreadBeforeSwitch();
      conversationApi.handleSelectConversation(conversationId, targetProjectPath);
      const resolvedPath = targetProjectPath ?? projectPath;
      const conversation =
        conversationState.conversations.find((c) => c.id === conversationId) ??
        filterThreadsByProject(conversationState, resolvedPath).find(
          (c) => c.id === conversationId
        );
      if (conversation) {
        onHydrateThreadSettings(conversation.threadSettings);
        if (activeProjectKey) {
          const sessionKey = resolveDraftSessionKey(activeProjectKey, conversation.id);
          onSetDraftMessage(onLoadDraftForSession(sessionKey));
        }
      } else {
        hydrateThread(undefined);
      }
    },
    [
      persistCurrentThreadBeforeSwitch,
      conversationApi,
      conversationState,
      projectPath,
      hydrateThread,
      onHydrateThreadSettings,
      onLoadDraftForSession,
      onSetDraftMessage,
      activeProjectKey,
    ]
  );

  const handleNewThread = useCallback(
    (targetProjectPath?: string) => {
      const resolvedProjectPath =
        typeof targetProjectPath === 'string' ? targetProjectPath : undefined;
      persistCurrentThreadBeforeSwitch();
      conversationApi.handleNewConversation(resolvedProjectPath);
      onHydrateThreadSettings(undefined);
      if (activeProjectKey) {
        onSaveDraftForSession(buildComposeDraftSessionKey(activeProjectKey), '');
      }
      onSetDraftMessage('');
    },
    [
      persistCurrentThreadBeforeSwitch,
      conversationApi,
      onHydrateThreadSettings,
      onSaveDraftForSession,
      onSetDraftMessage,
      activeProjectKey,
      projectPath,
    ]
  );

  const requestDeleteThread = useCallback((thread: AgentThreadListItem) => {
    setPendingDeleteThread(thread);
  }, []);

  const confirmDeleteThread = useCallback(async () => {
    if (!pendingDeleteThread || isDeletingThread) return;
    setIsDeletingThread(true);
    try {
      if (pendingDeleteThread.id === selectedThreadId) {
        persistCurrentThreadBeforeSwitch();
      }
      await conversationApi.handleDeleteConversation(pendingDeleteThread);
      setPendingDeleteThread(null);
    } finally {
      setIsDeletingThread(false);
    }
  }, [
    pendingDeleteThread,
    isDeletingThread,
    selectedThreadId,
    persistCurrentThreadBeforeSwitch,
    conversationApi,
  ]);

  const updateCurrentThreadSettings = useCallback(
    (partial: Partial<AgentThreadSettings>) => {
      if (!selectedThreadId) return;
      onSetConversationState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((conversation) => {
          if (conversation.id !== selectedThreadId) return conversation;
          return {
            ...conversation,
            threadSettings: {
              ...(conversation.threadSettings ?? {}),
              ...partial,
            },
            updatedAt: Date.now(),
          };
        }),
      }));
    },
    [selectedThreadId, onSetConversationState]
  );

  return {
    threadsForProject,
    threadListItems,
    threadsByProject,
    selectedThreadId,
    pendingDeleteThread,
    setPendingDeleteThread,
    isDeletingThread,
    handleNewThread,
    handleSelectThread,
    requestDeleteThread,
    confirmDeleteThread,
    startRenameThread: conversationApi.startRenameConversation,
    cancelRenameThread: conversationApi.cancelRenameConversation,
    commitRenameThread: conversationApi.commitRenameConversation,
    updateCurrentThreadSettings,
    persistCurrentThreadBeforeSwitch,
    hydrateThread,
  };
}
