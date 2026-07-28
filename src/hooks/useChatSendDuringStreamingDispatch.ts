import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ChatSendDuringStreamingMode } from '../types/settings';
import type { AttachedFile, PendingImageAttachment } from '../components/chat/types';

export interface QueuedComposerPayload {
  inputValue: string;
  attachedFiles: AttachedFile[];
  attachedImages: PendingImageAttachment[];
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
}

function createQueueItemId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
}: UseChatSendDuringStreamingDispatchOptions<TOverrides>) {
  const [queuedMessages, setQueuedMessages] = useState<QueuedComposerItem[]>([]);
  const queueRef = useRef<QueuedComposerItem[]>([]);
  const flushingRef = useRef(false);

  const syncQueue = useCallback((next: QueuedComposerItem[]) => {
    queueRef.current = next;
    setQueuedMessages(next);
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current || isStreamingBusy || isStopping) {
      return;
    }
    const [next, ...rest] = queueRef.current;
    if (!next) {
      return;
    }

    flushingRef.current = true;
    syncQueue(rest);
    try {
      await sendMessage(toSendOverrides(next));
    } finally {
      flushingRef.current = false;
      if (!isStreamingBusy && !isStopping && queueRef.current.length > 0) {
        void flushQueue();
      }
    }
  }, [isStreamingBusy, isStopping, sendMessage, syncQueue, toSendOverrides]);

  useEffect(() => {
    if (isStreamingBusy || isStopping) {
      return;
    }
    if (queueRef.current.length === 0) {
      return;
    }
    void flushQueue();
  }, [isStreamingBusy, isStopping, flushQueue]);

  const removeQueuedMessage = useCallback(
    (id: string) => {
      syncQueue(queueRef.current.filter((item) => item.id !== id));
    },
    [syncQueue]
  );

  const restoreQueuedMessage = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (!item) {
        return;
      }
      let next = queueRef.current.filter((entry) => entry.id !== id);
      if (hasInput) {
        next = [
          ...next,
          {
            id: createQueueItemId(),
            ...stabilizeQueuedPayload(snapshotComposer()),
          },
        ];
      }
      syncQueue(next);
      restoreComposer(stabilizeQueuedPayload(item));
    },
    [hasInput, restoreComposer, snapshotComposer, syncQueue]
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

      const snapshot = stabilizeQueuedPayload(snapshotComposer());
      syncQueue([
        ...queueRef.current,
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
    sendMessage,
    snapshotComposer,
    stopStreaming,
    syncQueue,
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
