import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getProjectState,
  saveProjectState,
  projectStorageKey,
} from '../../../utils/agentPersistence';
import {
  sanitizeConversationStateForPersistence,
  toProjectConversationStateForPersistence,
  collectImagePathsFromMessages,
  normalizeProjectPath,
  parseStorageProjectKeyFromSessionKey,
  projectStateToAgentConversationState,
  type AgentThreadListItem,
} from '../utils';
import {
  seedProjectPersistenceSnapshot,
  removeProjectStateBackupFromLocalStorage,
} from './useAgentInit';
import { type Agent } from '../../../utils/agentPersistence';
import type { AgentConversationState } from '../../../types/chat';
import type { PendingFileChange } from '../utils';
import { clearPlan } from '../../../features/agent-engine/planStore';

export interface UseAgentConversationsOptions {
  projectPath?: string;
  activeProjectKey: string;
  agent: Agent | null;
  conversationStateRef: React.MutableRefObject<AgentConversationState>;
  onSetConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
  onSetDraftMessage: (msg: string) => void;
  onSetError: (msg: string | null) => void;
  onSetRenamingConversationId: (id: string | null) => void;
  onSetRenamingConversationTitle: (title: string) => void;
  renamingConversationId: string | null;
  renamingConversationTitle: string;
  lastSavedSnapshotByProjectRef: React.MutableRefObject<Record<string, string>>;
  draftTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSetPendingChangesBySession: React.Dispatch<
    React.SetStateAction<Record<string, PendingFileChange[]>>
  >;
  onClearSessionExtras?: (sessionKey: string) => void;
  onRefreshThreadSummaries?: () => Promise<void>;
  onInvalidatePendingProjectPersist?: (projectKey: string) => void;
}

export interface UseAgentConversationsResult {
  handleNewConversation: (targetProjectPath?: string) => void;
  handleSelectConversation: (conversationId: string, targetProjectPath?: string) => void;
  startRenameConversation: (conversationId: string, currentTitle: string) => void;
  cancelRenameConversation: () => void;
  commitRenameConversation: (conversationId: string) => void;
  handleDeleteConversation: (thread: AgentThreadListItem) => Promise<void>;
}

export function useAgentConversations(
  options: UseAgentConversationsOptions
): UseAgentConversationsResult {
  const {
    projectPath = '',
    activeProjectKey,
    agent,
    conversationStateRef,
    onSetConversationState,
    onSetDraftMessage,
    onSetError,
    onSetRenamingConversationId,
    onSetRenamingConversationTitle,
    renamingConversationId,
    renamingConversationTitle,
    lastSavedSnapshotByProjectRef,
    draftTextareaRef,
    onSetPendingChangesBySession,
    onClearSessionExtras,
    onRefreshThreadSummaries,
    onInvalidatePendingProjectPersist,
  } = options;

  const activeProjectPathKey = normalizeProjectPath(projectPath);

  const patchProjectSelection = useCallback(
    (
      state: AgentConversationState,
      conversationId: string | null,
      targetProjectPath?: string
    ): AgentConversationState => {
      const key = normalizeProjectPath(targetProjectPath ?? projectPath);
      return {
        ...state,
        selectedConversationId: conversationId,
        selectedConversationIdByProject: {
          ...(state.selectedConversationIdByProject ?? {}),
          [key]: conversationId,
        },
      };
    },
    [projectPath]
  );

  const handleNewConversation = useCallback(
    (targetProjectPath?: string) => {
      if (!agent) return;
      onSetRenamingConversationId(null);
      onSetRenamingConversationTitle('');
      onSetConversationState((prev) =>
        patchProjectSelection(
          {
            ...prev,
            conversations: prev.conversations ?? [],
          },
          null,
          targetProjectPath
        )
      );
      onSetDraftMessage('');
      onSetError(null);
      if (draftTextareaRef.current) {
        draftTextareaRef.current.style.height = 'auto';
      }
    },
    [
      agent,
      patchProjectSelection,
      onSetConversationState,
      onSetDraftMessage,
      onSetError,
      onSetRenamingConversationId,
      onSetRenamingConversationTitle,
      draftTextareaRef,
    ]
  );

  const handleSelectConversation = useCallback(
    (conversationId: string, targetProjectPath?: string) => {
      if (!agent) return;
      onSetRenamingConversationId(null);
      onSetRenamingConversationTitle('');
      onSetConversationState((prev) =>
        patchProjectSelection(prev, conversationId, targetProjectPath)
      );
      onSetError(null);
    },
    [
      agent,
      patchProjectSelection,
      onSetConversationState,
      onSetError,
      onSetRenamingConversationId,
      onSetRenamingConversationTitle,
    ]
  );

  const startRenameConversation = useCallback(
    (conversationId: string, currentTitle: string) => {
      onSetRenamingConversationId(conversationId);
      onSetRenamingConversationTitle(currentTitle);
    },
    [onSetRenamingConversationId, onSetRenamingConversationTitle]
  );

  const cancelRenameConversation = useCallback(() => {
    onSetRenamingConversationId(null);
    onSetRenamingConversationTitle('');
  }, [onSetRenamingConversationId, onSetRenamingConversationTitle]);

  const commitRenameConversation = useCallback(
    (conversationId: string) => {
      if (!agent) return;
      const nextTitle = renamingConversationTitle.trim();
      if (!nextTitle) {
        cancelRenameConversation();
        return;
      }
      onSetConversationState((prev) => {
        const conversations = prev.conversations.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          return {
            ...conversation,
            title: nextTitle,
            updatedAt: Date.now(),
          };
        });
        return {
          ...prev,
          conversations,
        };
      });
      cancelRenameConversation();
    },
    [agent, renamingConversationTitle, onSetConversationState, cancelRenameConversation]
  );

  const handleDeleteConversation = useCallback(
    async (thread: AgentThreadListItem) => {
      if (!agent) return;

      const conversationId = thread.id;
      const threadProjectPath = thread.projectPath?.trim() || projectPath;
      let storageProjectKey = parseStorageProjectKeyFromSessionKey(thread.sessionKey);
      if (!storageProjectKey) {
        storageProjectKey = await projectStorageKey(threadProjectPath);
      }

      if (renamingConversationId === conversationId) {
        cancelRenameConversation();
      }

      const threadProjectKey = normalizeProjectPath(threadProjectPath);
      const affectsActiveProject =
        storageProjectKey === activeProjectKey || threadProjectKey === activeProjectPathKey;

      let workingState = conversationStateRef.current;
      const conversationInMemory = workingState.conversations.some(
        (conversation) => conversation.id === conversationId
      );

      if (!conversationInMemory || !affectsActiveProject) {
        const raw = await getProjectState(storageProjectKey);
        if (!raw?.conversations.some((conversation) => conversation.id === conversationId)) {
          return;
        }
        workingState = projectStateToAgentConversationState(raw, threadProjectPath);
      }

      const deletingConversation = workingState.conversations.find(
        (conversation) => conversation.id === conversationId
      );
      if (!deletingConversation) return;

      // Plan follows the thread — drop runtime cache when the conversation is deleted
      clearPlan(conversationId);

      const deletedImagePaths = collectImagePathsFromMessages(deletingConversation.messages);
      const remaining = workingState.conversations.filter(
        (conversation) => conversation.id !== conversationId
      );
      const remainingForProject = remaining.filter(
        (conversation) => normalizeProjectPath(conversation.projectPath ?? '') === threadProjectKey
      );
      const nextSelectedId =
        workingState.selectedConversationId === conversationId
          ? (remainingForProject.at(-1)?.id ?? null)
          : workingState.selectedConversationId;

      const nextState: AgentConversationState = patchProjectSelection(
        {
          ...workingState,
          conversations: remaining,
        },
        remainingForProject.length === 0 ? null : nextSelectedId,
        threadProjectPath
      );

      const mergedState: AgentConversationState = affectsActiveProject
        ? nextState
        : {
            ...conversationStateRef.current,
            conversations: conversationStateRef.current.conversations.filter(
              (conversation) => conversation.id !== conversationId
            ),
          };

      if (affectsActiveProject) {
        onSetConversationState(nextState);
        conversationStateRef.current = nextState;
      } else if (
        mergedState.conversations.length !== conversationStateRef.current.conversations.length
      ) {
        onSetConversationState(mergedState);
        conversationStateRef.current = mergedState;
      }

      if (onClearSessionExtras) {
        onClearSessionExtras(thread.sessionKey);
      } else {
        onSetPendingChangesBySession((prev) => {
          if (!prev[thread.sessionKey]) return prev;
          const next = { ...prev };
          delete next[thread.sessionKey];
          return next;
        });
      }

      try {
        const persistable = sanitizeConversationStateForPersistence(nextState);
        const snapshot = JSON.stringify(toProjectConversationStateForPersistence(persistable));
        await saveProjectState(
          storageProjectKey,
          toProjectConversationStateForPersistence(persistable)
        );
        lastSavedSnapshotByProjectRef.current[storageProjectKey] = snapshot;
        seedProjectPersistenceSnapshot(storageProjectKey, nextState);
        removeProjectStateBackupFromLocalStorage(storageProjectKey);
        onInvalidatePendingProjectPersist?.(storageProjectKey);

        if (deletedImagePaths.length > 0) {
          await invoke('cleanup_unreferenced_chat_images', {
            candidatePaths: deletedImagePaths,
          });
        }

        await onRefreshThreadSummaries?.();
      } catch (error) {
        console.error('删除会话后保存项目状态失败', storageProjectKey, error);
      }
    },
    [
      agent,
      activeProjectKey,
      activeProjectPathKey,
      projectPath,
      renamingConversationId,
      conversationStateRef,
      onSetConversationState,
      onSetPendingChangesBySession,
      onClearSessionExtras,
      lastSavedSnapshotByProjectRef,
      cancelRenameConversation,
      onRefreshThreadSummaries,
      onInvalidatePendingProjectPersist,
      patchProjectSelection,
    ]
  );

  return {
    handleNewConversation,
    handleSelectConversation,
    startRenameConversation,
    cancelRenameConversation,
    commitRenameConversation,
    handleDeleteConversation,
  };
}
