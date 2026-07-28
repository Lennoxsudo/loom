import { useCallback, useEffect, useRef } from 'react';
import type { StreamSendMode } from '../types/settings';

export interface StreamSendQueueItem<TFiles, TImages> {
  inputValue: string;
  attachedFiles: TFiles[];
  attachedImages: TImages[];
}

interface UseStreamSendQueueOptions<TFiles, TImages> {
  mode: StreamSendMode;
  isBusy: boolean;
  isStopping: boolean;
  hasSendableContent: () => boolean;
  getSendableSnapshot: () => StreamSendQueueItem<TFiles, TImages>;
  clearComposer: () => void;
  stopStreaming: () => Promise<void>;
  performSend: (item: StreamSendQueueItem<TFiles, TImages>) => Promise<void>;
}

export function useStreamSendQueue<TFiles, TImages>({
  mode,
  isBusy,
  isStopping,
  hasSendableContent,
  getSendableSnapshot,
  clearComposer,
  stopStreaming,
  performSend,
}: UseStreamSendQueueOptions<TFiles, TImages>) {
  const queueRef = useRef<StreamSendQueueItem<TFiles, TImages>[]>([]);
  const flushingRef = useRef(false);

  const flushQueue = useCallback(async () => {
    if (isBusy || isStopping || flushingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;

    flushingRef.current = true;
    try {
      await performSend(next);
    } finally {
      flushingRef.current = false;
    }
  }, [isBusy, isStopping, performSend]);

  useEffect(() => {
    if (!isBusy && !isStopping) {
      void flushQueue();
    }
  }, [isBusy, isStopping, flushQueue]);

  const handleSend = useCallback(async () => {
    if (!hasSendableContent() || isStopping) return;

    if (!isBusy) {
      const snapshot = getSendableSnapshot();
      clearComposer();
      await performSend(snapshot);
      return;
    }

    if (mode === 'interrupt_and_send') {
      await stopStreaming();
      if (!hasSendableContent()) return;
      const snapshot = getSendableSnapshot();
      clearComposer();
      await performSend(snapshot);
      return;
    }

    queueRef.current.push(getSendableSnapshot());
    clearComposer();
  }, [
    clearComposer,
    getSendableSnapshot,
    hasSendableContent,
    isBusy,
    isStopping,
    mode,
    performSend,
    stopStreaming,
  ]);

  return { handleSend };
}
