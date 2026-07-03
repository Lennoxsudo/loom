import { useCallback, useEffect, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { smoothScrollToBottom } from '../../utils/smoothScroll';

const DEFAULT_THRESHOLD = 80;

export interface UseChatStickToBottomOptions {
  virtuosoRef: React.MutableRefObject<VirtuosoHandle | null>;
  /** The actual DOM scroller element (from Virtuoso's scrollerRef callback). */
  scrollerRef?: React.MutableRefObject<HTMLDivElement | null>;
  threshold?: number;
}

export interface UseChatStickToBottomResult {
  /** Virtuoso followOutput — 'auto' when stuck, false when user scrolled away. */
  followOutput: false | 'auto';
  /** px threshold for atBottom detection. */
  atBottomThreshold: number;
  /** Virtuoso atBottomStateChange. */
  onAtBottomStateChange: (atBottom: boolean) => void;
  /** Virtuoso totalListHeightChanged — re-scrolls if stuck. */
  onTotalListHeightChanged: () => void;
  /** Virtuoso isScrolling — tracks user scrolling. */
  onIsScrolling: (scrolling: boolean) => void;
  /** Whether the "scroll to bottom" button is visible. */
  showScrollButton: boolean;
  /** Ref tracking whether user is actively scrolling. */
  isUserScrollingRef: React.MutableRefObject<boolean>;
  /** Smooth-scroll to bottom and re-stick (button click). */
  scrollToBottom: () => void;
  /** Instantly stick to bottom (new message sent). */
  stickToBottom: () => void;
}

/**
 * Consolidates all "stick to bottom" auto-scroll behaviour for the chat
 * Virtuoso list.
 *
 * Key design decisions:
 * - **Single source of truth**: `isAtBottomRef` (internal) drives
 *   `followOutput`, `showScrollButton`, and height-change re-scroll.
 * - **No manual scroll listener**: Virtuoso's `atBottomStateChange`
 *   already fires when the user scrolls away from the bottom — no
 *   need for a hand-rolled `scroll` handler or `isProgrammaticScrollRef`.
 * - **No retry storms**: a single `requestAnimationFrame` scheduling
 *   replaces the old `[0, 48, 120, 240, 400]` timeout cascade and the
 *   1-second `setInterval` in the scroll-to-bottom button handler.
 *   Virtuoso's own `followOutput: 'auto'` provides a second safety net
 *   when data changes.
 * - **followOutput as value, not function**: returning a plain value
 *   instead of a function avoids Virtuoso re-evaluating on every render,
 *   which can cause micro-jitter during streaming.
 * - **Debounced totalListHeightChanged re-scroll**: when already at bottom,
 *   Virtuoso's `followOutput: 'auto'` handles the scroll automatically.
 *   We only need a manual re-scroll for container resizes that Virtuoso
 *   doesn't detect (e.g., bottom dock height changes), and we debounce
 *   those to avoid competing with followOutput.
 */
export function useChatStickToBottom({
  virtuosoRef,
  scrollerRef,
  threshold = DEFAULT_THRESHOLD,
}: UseChatStickToBottomOptions): UseChatStickToBottomResult {
  const [followOutput, setFollowOutput] = useState<false | 'auto'>('auto');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const isUserScrollingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const cancelSmoothScrollRef = useRef<(() => void) | null>(null);
  const heightChangeRafRef = useRef<number | null>(null);

  const scrollToIndex = useCallback((behavior?: 'auto' | 'smooth') => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: behavior ?? 'auto',
      });
    });
  }, [virtuosoRef]);

  const stickToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setFollowOutput('auto');
    setShowScrollButton(false);
    scrollToIndex();
  }, [scrollToIndex]);

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setFollowOutput('auto');
    setShowScrollButton(false);

    // Prefer direct DOM smooth scroll (reliable for virtualized lists).
    // Virtuoso's scrollToIndex({ behavior: 'smooth' }) is unreliable when the
    // target item is outside the rendered viewport or when new items arrive
    // during the animation.
    const el = scrollerRef?.current;
    if (el) {
      cancelSmoothScrollRef.current?.();
      cancelSmoothScrollRef.current = smoothScrollToBottom(el, {
        onComplete: () => {
          cancelSmoothScrollRef.current = null;
        },
      });
      return;
    }

    // Fallback: Virtuoso scrollToIndex
    scrollToIndex('smooth');
  }, [scrollerRef, scrollToIndex]);

  const onAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setFollowOutput(atBottom ? 'auto' : false);
    setShowScrollButton(!atBottom);
  }, []);

  const onTotalListHeightChanged = useCallback(() => {
    // When at the bottom, Virtuoso's followOutput:'auto' already handles
    // re-scrolling on content changes. We only need manual re-scroll for
    // container-only resizes (e.g., bottom dock), and we debounce to avoid
    // competing with followOutput.
    if (!isAtBottomRef.current) return;
    if (heightChangeRafRef.current != null) return;
    heightChangeRafRef.current = requestAnimationFrame(() => {
      heightChangeRafRef.current = null;
      if (!isAtBottomRef.current) return;
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      });
    });
  }, [virtuosoRef]);

  const onIsScrolling = useCallback((scrolling: boolean) => {
    isUserScrollingRef.current = scrolling;
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (heightChangeRafRef.current != null) {
        cancelAnimationFrame(heightChangeRafRef.current);
      }
      cancelSmoothScrollRef.current?.();
    };
  }, []);

  return {
    followOutput,
    atBottomThreshold: threshold,
    onAtBottomStateChange,
    onTotalListHeightChanged,
    onIsScrolling,
    showScrollButton,
    isUserScrollingRef,
    scrollToBottom,
    stickToBottom,
  };
}
