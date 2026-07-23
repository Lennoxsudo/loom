import type { MutableRefObject } from 'react';

const SCROLL_RETRY_DELAYS_MS = [0, 48, 120, 240, 400] as const;

function runAfterPaint(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

export function scrollContainerToBottom(
  element: HTMLElement,
  behavior: ScrollBehavior = 'auto'
): void {
  const top = Math.max(element.scrollHeight - element.clientHeight, 0);
  if (behavior === 'smooth') {
    element.scrollTo({ top, behavior: 'smooth' });
    return;
  }
  element.scrollTop = top;
}

export function scheduleScrollContainerToBottom(
  containerRef: { current: HTMLElement | null },
  options?: {
    markNearBottom?: MutableRefObject<boolean>;
    behavior?: ScrollBehavior;
  }
): void {
  if (options?.markNearBottom) {
    options.markNearBottom.current = true;
  }

  const scroll = () => {
    const element = containerRef.current;
    if (!element) return;
    scrollContainerToBottom(element, options?.behavior ?? 'auto');
  };

  runAfterPaint(() => {
    scroll();
    for (const delay of SCROLL_RETRY_DELAYS_MS) {
      window.setTimeout(scroll, delay);
    }
  });
}
