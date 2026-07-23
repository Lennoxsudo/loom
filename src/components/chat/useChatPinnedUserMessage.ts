import { useCallback, useEffect, useRef, useState } from 'react';
import { findPinnedChatUserMessage, shouldShowChatStickyOverlay } from './chatPinnedUserMessage';
import type { Message } from './types';
import type { UserMessageLayoutCache } from '../agent/messageScrollUtils';

interface ChatPinnedState {
  message: Message | null;
  showOverlay: boolean;
}

interface UseChatPinnedUserMessageOptions {
  messages: Message[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  getLayoutCache: () => UserMessageLayoutCache;
  watchKey?: string | null;
}

const EMPTY_PINNED_STATE: ChatPinnedState = { message: null, showOverlay: false };

export function useChatPinnedUserMessage({
  messages,
  scrollContainerRef,
  getLayoutCache,
  watchKey = null,
}: UseChatPinnedUserMessageOptions) {
  const [pinnedState, setPinnedState] = useState<ChatPinnedState>(EMPTY_PINNED_STATE);
  const pinnedIdRef = useRef<string | null>(null);

  const updatePinned = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      pinnedIdRef.current = null;
      setPinnedState(EMPTY_PINNED_STATE);
      return;
    }

    const next = findPinnedChatUserMessage(
      messages,
      container,
      getLayoutCache(),
      pinnedIdRef.current
    );
    const showOverlay = next ? shouldShowChatStickyOverlay(next, container) : false;
    pinnedIdRef.current = next?.id ?? null;

    setPinnedState((prev) => {
      if (prev.message?.id === next?.id && prev.showOverlay === showOverlay) {
        return prev;
      }
      return { message: next, showOverlay };
    });
  }, [getLayoutCache, messages, scrollContainerRef]);

  useEffect(() => {
    pinnedIdRef.current = null;
    updatePinned();
  }, [messages, updatePinned, watchKey]);

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

      updatePinned();
      container.addEventListener('scroll', updatePinned, { passive: true });
      resizeObserver = new ResizeObserver(updatePinned);
      resizeObserver.observe(container);
    };

    attach();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(attachFrameId);
      if (container) {
        container.removeEventListener('scroll', updatePinned);
      }
      resizeObserver?.disconnect();
    };
  }, [updatePinned, scrollContainerRef, watchKey, messages.length]);

  return {
    pinnedMessage: pinnedState.message,
    showStickyOverlay: pinnedState.showOverlay,
    scheduleUpdate: updatePinned,
  };
}
