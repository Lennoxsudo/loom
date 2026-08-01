import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ChatSendDuringStreamingMode } from '../types/settings';
import type { AttachedFile, PendingImageAttachment } from '../components/chat/types';

export interface QueuedComposerPayload {
  inputValue: string;
  attachedFiles: AttachedFile[];
  attachedImages: PendingImageAttachment[];
  contextAnnotations?: import('../utils/contextAnnotations').ContextAnnotation[];
}

export interface QueuedComposerItem extends QueuedComposerPayload {
  id: string;
}

export interface UseChatSendDuringStreamingDispatchOptions<TOverrides> {
  mode: ChatSendDuringStreamingMode;
  isStreamingBusy: boolean;
  isStopping: boolean;
  hasInput: boolean;
  canSendWhileIdle: boolean;
  snapshotComposer: () => QueuedComposerPayload;
  clearComposer: () => void;
  restoreComposer: (payload: QueuedComposerPayload) => void;
  sendMessage: (overrides?: TOverrides) => Promise<void>;
  stopStreaming: () => Promise<void>;
  toSendOverrides: (payload: QueuedComposerPayload) => TOverrides;
  /**
   * Isolate the send queue per conversation/thread.
   * When unset/empty, uses a single shared fallback scope (legacy behavior).
   */
  scopeKey?: string | null;
}

const FALLBACK_SCOPE = '__default__';

function createQueueItemId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveScopeKey(scopeKey?: string | null): string {
  const trimmed = scopeKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : FALLBACK_SCOPE;
}

/** Prefer disk asset URL so clearComposer can revoke blob: previews safely. */
function stabilizeQueuedPayload(payload: QueuedComposerPayload): QueuedComposerPayload {
  if (payload.attachedImages.length === 0) {
    return payload;
  }
  return {
    ...payload,
    attachedImages: payload.attachedImages.map((img) => {
      if (!img.path) return img;
      try {
        return { ...img, previewUrl: convertFileSrc(img.path) };
      } catch {
        return img;
      }
    }),
  };
}

export function useChatSendDuringStreamingDispatch<TOverrides>({
  mode,
  isStreamingBusy,
  isStopping,
  hasInput,
  canSendWhileIdle,
  snapshotComposer,
  clearComposer,
  restoreComposer,
  sendMessage,
  stopStreaming,
  toSendOverrides,
  scopeKey,
}: UseChatSendDuringStreamingDispatchOptions<TOverrides>) {
  const [queuesByScope, setQueuesByScope] = useState<Record<string, QueuedComposerItem[]>>({});
  const queuesRef = useRef<Record<string, QueuedComposerItem[]>>({});
  const flushingRef = useRef(false);
  const activeScope = resolveScopeKey(scopeKey);

  const syncScopeQueue = useCallback((scope: string, next: QueuedComposerItem[]) => {
    const prev = queuesRef.current;
    let updated: Record<string, QueuedComposerItem[]>;
    if (next.length === 0) {
      if (!(scope in prev)) {
        return;
      }
      updated = { ...prev };
      delete updated[scope];
    } else {
      updated = { ...prev, [scope]: next };
    }
    queuesRef.current = updated;
    setQueuesByScope(updated);
  }, []);

  const queuedMessages = useMemo(
    () => queuesByScope[activeScope] ?? [],
    [queuesByScope, activeScope]
  );

  const flushQueue = useCallback(async () => {
    const scope = resolveScopeKey(scopeKey);
    if (flushingRef.current || isStreamingBusy || isStopping) {
      return;
    }
    const current = queuesRef.current[scope] ?? [];
    const [next, ...rest] = current;
    if (!next) {
      return;
    }

    flushingRef.current = true;
    syncScopeQueue(scope, rest);
    try {
      await sendMessage(toSendOverrides(next));
    } finally {
      flushingRef.current = false;
      const remaining = queuesRef.current[scope] ?? [];
      if (!isStreamingBusy && !isStopping && remaining.length > 0) {
        void flushQueue();
      }
    }
  }, [isStreamingBusy, isStopping, scopeKey, sendMessage, syncScopeQueue, toSendOverrides]);

  useEffect(() => {
    if (isStreamingBusy || isStopping) {
      return;
    }
    if ((queuesRef.current[activeScope] ?? []).length === 0) {
      return;
    }
    void flushQueue();
  }, [activeScope, isStreamingBusy, isStopping, flushQueue]);

  const removeQueuedMessage = useCallback(
    (id: string) => {
      const scope = resolveScopeKey(scopeKey);
      const current = queuesRef.current[scope] ?? [];
      syncScopeQueue(
        scope,
        current.filter((item) => item.id !== id)
      );
    },
    [scopeKey, syncScopeQueue]
  );

  const restoreQueuedMessage = useCallback(
    (id: string) => {
      const scope = resolveScopeKey(scopeKey);
      const current = queuesRef.current[scope] ?? [];
      const item = current.find((entry) => entry.id === id);
      if (!item) {
        return;
      }
      let next = current.filter((entry) => entry.id !== id);
      if (hasInput) {
        next = [
          ...next,
          {
            id: createQueueItemId(),
            ...stabilizeQueuedPayload(snapshotComposer()),
          },
        ];
      }
      syncScopeQueue(scope, next);
      restoreComposer(stabilizeQueuedPayload(item));
    },
    [hasInput, restoreComposer, scopeKey, snapshotComposer, syncScopeQueue]
  );

  const dispatchComposerSend = useCallback(async () => {
    if (!hasInput) {
      if (isStreamingBusy && !isStopping) {
        await stopStreaming();
      }
      return;
    }

    if (isStreamingBusy || isStopping) {
      if (mode === 'interrupt') {
        await stopStreaming();
        await sendMessage();
        return;
      }

      const scope = resolveScopeKey(scopeKey);
      const snapshot = stabilizeQueuedPayload(snapshotComposer());
      const current = queuesRef.current[scope] ?? [];
      syncScopeQueue(scope, [
        ...current,
        {
          id: createQueueItemId(),
          ...snapshot,
        },
      ]);
      clearComposer();
      return;
    }

    if (!canSendWhileIdle) {
      return;
    }
    await sendMessage();
  }, [
    canSendWhileIdle,
    clearComposer,
    hasInput,
    isStreamingBusy,
    isStopping,
    mode,
    scopeKey,
    sendMessage,
    snapshotComposer,
    stopStreaming,
    syncScopeQueue,
  ]);

  const canSendComposer = hasInput && !isStopping && (isStreamingBusy || canSendWhileIdle);
  const showStopButton = (isStreamingBusy || isStopping) && !hasInput;

  return {
    dispatchComposerSend,
    canSendComposer,
    showStopButton,
    queuedMessages,
    removeQueuedMessage,
    restoreQueuedMessage,
  };
}
