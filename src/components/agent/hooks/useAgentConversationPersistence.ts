import { useCallback, useEffect, useRef } from 'react';
import { saveProjectState } from '../../../utils/agentPersistence';
import { sanitizeConversationStateForPersistence, toProjectConversationStateForPersistence } from '../utils';
import type { AgentConversationState } from '../../../types/chat';
import {
  AGENT_CHAT_CONVERSATIONS_STORAGE_KEY,
  FILE_PERSIST_DEBOUNCE_MS,
  LOCAL_STORAGE_BACKUP_DEBOUNCE_MS,
} from '../../../types/chat';

export type SeedAgentPersistenceSnapshots = (snapshots: Record<string, string>) => void;

export const agentPersistenceSnapshotSeedRef: { current: SeedAgentPersistenceSnapshots | null } = {
  current: null,
};

function countConversationsInSnapshot(snapshot: string | undefined): number {
  if (!snapshot) return 0;
  try {
    const parsed = JSON.parse(snapshot) as { conversations?: unknown[] };
    return parsed.conversations?.length ?? 0;
  } catch {
    return 0;
  }
}

export interface UseAgentConversationPersistenceOptions {
  conversationState: AgentConversationState;
  activeProjectKey: string;
  isInitializing: boolean;
}

export function useAgentConversationPersistence(options: UseAgentConversationPersistenceOptions) {
  const { conversationState, activeProjectKey, isInitializing } = options;

  const filePersistTimerRef = useRef<number | null>(null);
  const localStorageBackupTimerRef = useRef<number | null>(null);
  const lastSavedSnapshotByProjectRef = useRef<Record<string, string>>({});
  const pendingPersistableRef = useRef<{
    projectKey: string;
    snapshot: string;
    persistable: ReturnType<typeof toProjectConversationStateForPersistence>;
  } | null>(null);

  const seedSnapshots = useCallback<SeedAgentPersistenceSnapshots>((snapshots) => {
    for (const [projectKey, snapshot] of Object.entries(snapshots)) {
      lastSavedSnapshotByProjectRef.current[projectKey] = snapshot;
    }
  }, []);

  useEffect(() => {
    agentPersistenceSnapshotSeedRef.current = seedSnapshots;
    return () => {
      if (agentPersistenceSnapshotSeedRef.current === seedSnapshots) {
        agentPersistenceSnapshotSeedRef.current = null;
      }
    };
  }, [seedSnapshots]);

  const flushProjectStateNow = useCallback(async (projectKey?: string) => {
    const key = projectKey ?? pendingPersistableRef.current?.projectKey;
    const pending = pendingPersistableRef.current;
    if (!key || !pending || pending.projectKey !== key) {
      return;
    }
    if (filePersistTimerRef.current) {
      window.clearTimeout(filePersistTimerRef.current);
      filePersistTimerRef.current = null;
    }
    const previousConversationCount = countConversationsInSnapshot(
      lastSavedSnapshotByProjectRef.current[key]
    );
    if (pending.persistable.conversations.length === 0 && previousConversationCount > 0) {
      console.warn(
        `跳过保存项目 ${key} 的空会话状态，避免覆盖 ${previousConversationCount} 条历史记录`
      );
      return;
    }
    try {
      await saveProjectState(key, pending.persistable);
      lastSavedSnapshotByProjectRef.current[key] = pending.snapshot;
    } catch (err) {
      console.error('保存 Agent 项目会话失败', key, err);
    }
  }, []);

  useEffect(() => {
    if (isInitializing || !activeProjectKey) return;

    const persistable = toProjectConversationStateForPersistence(
      sanitizeConversationStateForPersistence(conversationState)
    );
    const snapshot = JSON.stringify(persistable);
    if (snapshot === lastSavedSnapshotByProjectRef.current[activeProjectKey]) {
      return;
    }

    pendingPersistableRef.current = {
      projectKey: activeProjectKey,
      snapshot,
      persistable,
    };

    if (filePersistTimerRef.current) {
      window.clearTimeout(filePersistTimerRef.current);
    }

    filePersistTimerRef.current = window.setTimeout(() => {
      void flushProjectStateNow(activeProjectKey);
    }, FILE_PERSIST_DEBOUNCE_MS);
  }, [conversationState, activeProjectKey, isInitializing, flushProjectStateNow]);

  useEffect(() => {
    if (isInitializing || !activeProjectKey) return;
    if (localStorageBackupTimerRef.current) {
      window.clearTimeout(localStorageBackupTimerRef.current);
    }

    localStorageBackupTimerRef.current = window.setTimeout(() => {
      try {
        const persistable = toProjectConversationStateForPersistence(
          sanitizeConversationStateForPersistence(conversationState)
        );
        const raw = localStorage.getItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
        const backup: Record<string, ReturnType<typeof toProjectConversationStateForPersistence>> =
          raw ? JSON.parse(raw) : {};
        backup[activeProjectKey] = persistable;
        localStorage.setItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(backup));
      } catch {
        // ignore backup failures
      }
    }, LOCAL_STORAGE_BACKUP_DEBOUNCE_MS);

    return () => {
      if (localStorageBackupTimerRef.current) {
        window.clearTimeout(localStorageBackupTimerRef.current);
        localStorageBackupTimerRef.current = null;
      }
    };
  }, [conversationState, activeProjectKey, isInitializing]);

  useEffect(() => {
    return () => {
      void flushProjectStateNow();
      if (filePersistTimerRef.current) {
        window.clearTimeout(filePersistTimerRef.current);
        filePersistTimerRef.current = null;
      }
    };
  }, [flushProjectStateNow]);

  const invalidatePendingProjectPersist = useCallback((projectKey?: string) => {
    if (filePersistTimerRef.current) {
      window.clearTimeout(filePersistTimerRef.current);
      filePersistTimerRef.current = null;
    }
    if (!projectKey || pendingPersistableRef.current?.projectKey === projectKey) {
      pendingPersistableRef.current = null;
    }
  }, []);

  return {
    lastSavedSnapshotByProjectRef,
    flushProjectStateNow,
    seedSnapshots,
    invalidatePendingProjectPersist,
  };
}
