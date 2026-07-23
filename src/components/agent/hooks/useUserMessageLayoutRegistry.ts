import { useCallback, useRef } from 'react';
import type { UserMessageLayout, UserMessageLayoutCache } from '../messageScrollUtils';

export function useUserMessageLayoutRegistry(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
) {
  const cacheRef = useRef<Map<string, UserMessageLayout>>(new Map());

  const registerUserMessage = useCallback(
    (messageId: string, element: HTMLElement | null) => {
      const container = scrollContainerRef.current;
      if (!container || !element) return;

      const containerRect = container.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      cacheRef.current.set(messageId, {
        offsetTop: rect.top - containerRect.top + container.scrollTop,
        height: rect.height,
      });
    },
    [scrollContainerRef]
  );

  const getLayoutCache = useCallback((): UserMessageLayoutCache => cacheRef.current, []);

  const clearLayoutCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return {
    registerUserMessage,
    getLayoutCache,
    clearLayoutCache,
  };
}
