import { useCallback, useEffect, useRef } from 'react';
import { resolveDraftSessionKey } from '../utils';

export interface UsePersistedComposerDraftOptions {
  extrasLoaded: boolean;
  activeProjectKey: string;
  selectedThreadId: string | null;
  draftMessage: string;
  setDraftMessage: (draft: string) => void;
  loadDraftForSession: (sessionKey: string) => string;
  saveDraftForSession: (sessionKey: string, draft: string) => void;
}

/**
 * Persist composer draft per session key.
 * On session change: hydrate from storage and skip save (avoids writing the
 * previous thread's in-memory draft into the new session's key).
 */
export function usePersistedComposerDraft({
  extrasLoaded,
  activeProjectKey,
  selectedThreadId,
  draftMessage,
  setDraftMessage,
  loadDraftForSession,
  saveDraftForSession,
}: UsePersistedComposerDraftOptions): {
  markDraftSessionKey: (sessionKey: string | null) => void;
} {
  const draftSessionKeyRef = useRef<string | null>(null);

  const markDraftSessionKey = useCallback((sessionKey: string | null) => {
    draftSessionKeyRef.current = sessionKey;
  }, []);

  useEffect(() => {
    if (!extrasLoaded || !activeProjectKey) return;
    const sessionKey = resolveDraftSessionKey(activeProjectKey, selectedThreadId);

    if (draftSessionKeyRef.current !== sessionKey) {
      draftSessionKeyRef.current = sessionKey;
      setDraftMessage(loadDraftForSession(sessionKey));
      return;
    }

    saveDraftForSession(sessionKey, draftMessage);
  }, [
    draftMessage,
    activeProjectKey,
    selectedThreadId,
    extrasLoaded,
    loadDraftForSession,
    saveDraftForSession,
    setDraftMessage,
  ]);

  return { markDraftSessionKey };
}
