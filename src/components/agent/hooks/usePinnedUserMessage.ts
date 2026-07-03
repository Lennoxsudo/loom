import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../types/chat';
import { findPinnedUserMessage } from '../messageScrollUtils';
import type { UserMessageLayoutCache } from '../messageScrollUtils';

interface UsePinnedUserMessageOptions {
  messages: ChatMessage[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  getLayoutCache: () => UserMessageLayoutCache;
  watchKey?: string | null;
}

export function usePinnedUserMessage({
  messages,
  scrollContainerRef,
  getLayoutCache,
  watchKey = null,
}: UsePinnedUserMessageOptions) {
  const [pinnedMessage, setPinnedMessage] = useState<ChatMessage | null>(null);
  const rafRef = useRef<number | null>(null);

  const updatePinned = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      setPinnedMessage(null);
      return;
    }

    const next = findPinnedUserMessage(messages, container, getLayoutCache());
    setPinnedMessage((prev) => (prev?.id === next?.id ? prev : next));
  }, [getLayoutCache, messages, scrollContainerRef]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updatePinned();
    });
  }, [updatePinned]);

  useEffect(() => {
    scheduleUpdate();
  }, [messages, scheduleUpdate, watchKey]);

  useEffect(() => {
    let disposed = false;
    let attachFrameId = 0;
    let container: HTMLDivElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const attach = () => {
      if (disposed) return;

      container = scrollContainerRef.current;
      if (!container) {
        attachFrameId = window.requestAnimationFrame(attach);
        return;
      }

      scheduleUpdate();
      container.addEventListener('scroll', scheduleUpdate, { passive: true });
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(container);
    };

    attach();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(attachFrameId);
      if (container) {
        container.removeEventListener('scroll', scheduleUpdate);
      }
      resizeObserver?.disconnect();
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleUpdate, scrollContainerRef, watchKey, messages.length]);

  return {
    pinnedMessage,
    scheduleUpdate,
  };
}
