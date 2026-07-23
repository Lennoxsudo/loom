import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { normalizePathForCompare } from '../../../utils/pathUtils';
import { isMissingPathRollbackError } from '../../../utils/pendingChangeRollback';
import { useTranslation } from '../../../i18n';
import { buildPendingSessionKey, removePreviewEntriesFromConversation } from '../utils';
import type { AgentConversationState } from '../../../types/chat';
import type { PendingFileChange } from '../utils';

export interface UseAgentPendingChangesOptions {
  projectPathRef: React.MutableRefObject<string>;
  activeProjectKeyRef: React.MutableRefObject<string>;
  previewKey: string | null;
  onShowWarning: (message: string, title?: string) => void;
  onShowInfo: (message: string, title?: string) => void;
  onSetConversationState: React.Dispatch<React.SetStateAction<AgentConversationState>>;
  onSetPreviewOpenByAgent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSetPendingChangesBySession: React.Dispatch<
    React.SetStateAction<Record<string, PendingFileChange[]>>
  >;
  pendingChangesBySession: Record<string, PendingFileChange[]>;
  previewOpenByAgent: Record<string, boolean>;
  conversationStateRef: React.MutableRefObject<AgentConversationState>;
}

export interface UseAgentPendingChangesResult {
  focusPreviewFile: (conversationId: string, filePath: string) => void;
  removePreviewEntriesForConversation: (
    conversationId: string,
    filePaths: readonly string[]
  ) => void;
  acceptPendingChange: (change: PendingFileChange) => void;
  acceptAllPendingChanges: (changes: PendingFileChange[]) => void;
  rejectPendingChange: (change: PendingFileChange) => Promise<boolean>;
  rejectAllPendingChanges: (changes: PendingFileChange[]) => Promise<boolean>;
}

export function useAgentPendingChanges(
  options: UseAgentPendingChangesOptions
): UseAgentPendingChangesResult {
  const {
    projectPathRef,
    activeProjectKeyRef,
    previewKey,
    onShowWarning,
    onShowInfo,
    onSetConversationState,
    onSetPreviewOpenByAgent,
    onSetPendingChangesBySession,
    pendingChangesBySession,
    previewOpenByAgent,
    conversationStateRef,
  } = options;

  const t = useTranslation();

  const focusPreviewFile = useCallback(
    (conversationId: string, filePath: string) => {
      onSetConversationState((prev) => {
        const conversations = prev.conversations.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          const index = conversation.previewHistory.findIndex((item) => item.filePath === filePath);
          if (index < 0) return conversation;
          return {
            ...conversation,
            currentPreviewIndex: index,
          };
        });
        return {
          ...prev,
          conversations,
        };
      });
      if (previewKey) {
        onSetPreviewOpenByAgent((prev) => ({ ...prev, [previewKey]: true }));
      }
    },
    [onSetConversationState, onSetPreviewOpenByAgent, previewKey]
  );

  const removePreviewEntriesForConversationCb = useCallback(
    (conversationId: string, filePaths: readonly string[]) => {
      if (filePaths.length === 0) return;
      onSetConversationState((prev) => {
        let changed = false;
        const conversations = prev.conversations.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          const nextConversation = removePreviewEntriesFromConversation(
            conversation,
            new Set(filePaths)
          );
          if (nextConversation !== conversation) {
            changed = true;
          }
          return nextConversation;
        });
        if (!changed) return prev;
        return {
          ...prev,
          conversations,
        };
      });
    },
    [onSetConversationState]
  );

  const acceptPendingChange = useCallback(
    (change: PendingFileChange) => {
      const projectKey = activeProjectKeyRef.current;
      removePreviewEntriesForConversationCb(change.conversationId, [change.filePath]);
      onSetPendingChangesBySession((prev) => {
        const sessionKey = buildPendingSessionKey(projectKey, change.conversationId);
        const list = prev[sessionKey] ?? [];
        if (list.length === 0) return prev;
        const nextList = list.filter((item) => item.id !== change.id);
        if (nextList.length === list.length) return prev;
        if (nextList.length === 0) {
          const next = { ...prev };
          delete next[sessionKey];
          return next;
        }
        return {
          ...prev,
          [sessionKey]: nextList,
        };
      });
    },
    [activeProjectKeyRef, removePreviewEntriesForConversationCb, onSetPendingChangesBySession]
  );

  const acceptAllPendingChanges = useCallback(
    (changes: PendingFileChange[]) => {
      if (changes.length === 0) return;
      const projectKey = activeProjectKeyRef.current;
      const [{ conversationId }] = changes;
      removePreviewEntriesForConversationCb(
        conversationId,
        changes.map((change) => change.filePath)
      );
      onSetPendingChangesBySession((prev) => {
        const sessionKey = buildPendingSessionKey(projectKey, conversationId);
        if (!prev[sessionKey]) return prev;
        const next = { ...prev };
        delete next[sessionKey];
        return next;
      });
    },
    [activeProjectKeyRef, removePreviewEntriesForConversationCb, onSetPendingChangesBySession]
  );

  const rejectPendingChange = useCallback(
    async (change: PendingFileChange) => {
      if (!projectPathRef.current) return false;

      try {
        if (change.existedBefore === false && change.beforeContent === null) {
          await invoke('delete_file_or_folder', {
            path: change.filePath,
            permanent: false,
            rootPath: projectPathRef.current,
          });
        } else if (change.beforeContent !== null) {
          await invoke('write_file_content', {
            filePath: change.filePath,
            content: change.beforeContent,
          });
        } else {
          const fileName = change.filePath.split(/[/\\]/).pop() || change.filePath;
          onShowWarning(
            `${fileName} is missing rollback source content, so the file was kept to avoid deletion`,
            'Rollback stopped'
          );
          return false;
        }

        acceptPendingChange(change);
        return true;
      } catch (error) {
        if (isMissingPathRollbackError(error)) {
          acceptPendingChange(change);
          onShowInfo(t.chat.rollbackFileMissingSkipped.replace('{path}', change.filePath));
          return true;
        }

        onShowWarning(t.chat.rollbackFileFailed.replace('{error}', String(error)));
        return false;
      }
    },
    [projectPathRef, onShowWarning, onShowInfo, acceptPendingChange, t]
  );

  const rejectAllPendingChanges = useCallback(
    async (changes: PendingFileChange[]) => {
      for (const change of changes) {
        const ok = await rejectPendingChange(change);
        if (!ok) return false;
      }
      return true;
    },
    [rejectPendingChange]
  );

  useEffect(() => {
    const projectKey = activeProjectKeyRef.current;
    onSetConversationState((prev) => {
      let changed = false;
      const conversations = prev.conversations.map((conversation) => {
        if (conversation.previewHistory.length === 0) return conversation;

        const sessionKey = buildPendingSessionKey(projectKey, conversation.id);
        const pendingList = pendingChangesBySession[sessionKey] ?? [];
        const pendingFilePaths = new Set(
          pendingList.map((c) => normalizePathForCompare(c.filePath).toLowerCase())
        );

        const nextHistory = conversation.previewHistory.filter((item) => {
          if (item.originalContent === undefined) return true;
          return pendingFilePaths.has(normalizePathForCompare(item.filePath).toLowerCase());
        });

        if (nextHistory.length === conversation.previewHistory.length) return conversation;

        changed = true;
        const nextIndex = Math.min(
          conversation.currentPreviewIndex,
          Math.max(nextHistory.length - 1, 0)
        );
        return {
          ...conversation,
          previewHistory: nextHistory,
          currentPreviewIndex: nextIndex,
        };
      });

      return changed ? { ...prev, conversations } : prev;
    });

    if (!previewKey || !previewOpenByAgent[previewKey]) return;
    const state = conversationStateRef.current;
    const conv = state.conversations.find((c) => c.id === state.selectedConversationId);
    if (!conv || conv.previewHistory.length === 0) return;

    const sessionKey = buildPendingSessionKey(projectKey, conv.id);
    const pendingList = pendingChangesBySession[sessionKey] ?? [];
    if (pendingList.length > 0) return;

    const currentItem = conv.previewHistory[conv.currentPreviewIndex ?? 0];
    if (currentItem?.originalContent !== undefined) {
      onSetPreviewOpenByAgent((prev) => ({ ...prev, [previewKey]: false }));
    }
  }, [
    pendingChangesBySession,
    activeProjectKeyRef,
    previewKey,
    previewOpenByAgent,
    conversationStateRef,
    onSetConversationState,
    onSetPreviewOpenByAgent,
  ]);

  return {
    focusPreviewFile,
    removePreviewEntriesForConversation: removePreviewEntriesForConversationCb,
    acceptPendingChange,
    acceptAllPendingChanges,
    rejectPendingChange,
    rejectAllPendingChanges,
  };
}
