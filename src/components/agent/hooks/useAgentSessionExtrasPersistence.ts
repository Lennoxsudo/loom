import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  createDebouncedSessionExtrasSaver,
  loadAgentSessionExtras,
  readInitialSessionExtras,
  type AgentSessionExtras,
} from '../../../utils/agentSessionPersistence';
import type { PendingFileChange } from '../utils';

export interface UseAgentSessionExtrasPersistenceResult {
  pendingChangesBySession: Record<string, PendingFileChange[]>;
  setPendingChangesBySession: React.Dispatch<
    React.SetStateAction<Record<string, PendingFileChange[]>>
  >;
  saveDraftForSession: (sessionKey: string, draft: string) => void;
  loadDraftForSession: (sessionKey: string) => string;
  clearSessionExtras: (sessionKey: string) => void;
  clearSessionExtrasForProject: (projectKey: string) => void;
  extrasLoaded: boolean;
}

export function useAgentSessionExtrasPersistence(): UseAgentSessionExtrasPersistenceResult {
  const initialExtrasRef = useRef<AgentSessionExtras | null>(null);
  if (!initialExtrasRef.current) {
    initialExtrasRef.current = readInitialSessionExtras();
  }

  const draftsRef = useRef<Record<string, string>>({ ...initialExtrasRef.current.drafts });
  const pendingChangesRef = useRef<Record<string, PendingFileChange[]>>({
    ...initialExtrasRef.current.pendingChanges,
  });
  const saverRef = useRef(createDebouncedSessionExtrasSaver());
  const [pendingChangesBySession, setPendingChangesBySession] = useState<
    Record<string, PendingFileChange[]>
  >(() => ({ ...initialExtrasRef.current!.pendingChanges }));
  const [extrasLoaded, setExtrasLoaded] = useState(!isTauri());

  const schedulePersist = useCallback(() => {
    saverRef.current.schedule({
      version: 1,
      drafts: { ...draftsRef.current },
      pendingChanges: { ...pendingChangesRef.current },
    });
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    void loadAgentSessionExtras().then((extras) => {
      if (cancelled) return;
      draftsRef.current = { ...extras.drafts };
      pendingChangesRef.current = { ...extras.pendingChanges };
      setPendingChangesBySession(extras.pendingChanges);
      setExtrasLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      void saverRef.current.flushNow();
      saverRef.current.cancel();
    };
  }, []);

  const saveDraftForSession = useCallback(
    (sessionKey: string, draft: string) => {
      const trimmed = draft.trim();
      if (trimmed) {
        draftsRef.current[sessionKey] = draft;
      } else {
        delete draftsRef.current[sessionKey];
      }
      schedulePersist();
    },
    [schedulePersist]
  );

  const loadDraftForSession = useCallback((sessionKey: string) => {
    return draftsRef.current[sessionKey] ?? '';
  }, []);

  const clearSessionExtras = useCallback(
    (sessionKey: string) => {
      delete draftsRef.current[sessionKey];
      delete pendingChangesRef.current[sessionKey];
      setPendingChangesBySession((prev) => {
        if (!prev[sessionKey]) return prev;
        const next = { ...prev };
        delete next[sessionKey];
        return next;
      });
      schedulePersist();
    },
    [schedulePersist]
  );

  const clearSessionExtrasForProject = useCallback(
    (projectKey: string) => {
      const prefix = `${projectKey}::`;
      for (const key of Object.keys(draftsRef.current)) {
        if (key.startsWith(prefix)) {
          delete draftsRef.current[key];
        }
      }
      for (const key of Object.keys(pendingChangesRef.current)) {
        if (key.startsWith(prefix)) {
          delete pendingChangesRef.current[key];
        }
      }
      setPendingChangesBySession((prev) => {
        const next: Record<string, PendingFileChange[]> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (!key.startsWith(prefix)) {
            next[key] = value;
          }
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
      schedulePersist();
    },
    [schedulePersist]
  );

  const setPendingChangesBySessionWithPersist = useCallback<
    React.Dispatch<React.SetStateAction<Record<string, PendingFileChange[]>>>
  >(
    (updater) => {
      setPendingChangesBySession((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        pendingChangesRef.current = next;
        schedulePersist();
        return next;
      });
    },
    [schedulePersist]
  );

  return {
    pendingChangesBySession,
    setPendingChangesBySession: setPendingChangesBySessionWithPersist,
    saveDraftForSession,
    loadDraftForSession,
    clearSessionExtras,
    clearSessionExtrasForProject,
    extrasLoaded,
  };
}
