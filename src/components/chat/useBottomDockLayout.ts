import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';

export interface BottomDockLayoutState {
  /** Height of the expanded TodoListBar panel that overlays the message list (0 when collapsed). */
  overlayInset: number;
  /** Monotonically increasing counter that bumps whenever the bottom dock resizes. */
  resizeKey: number;
}

export interface UseBottomDockLayoutResult extends BottomDockLayoutState {
  /** Pass this to TodoListBar's `onLayoutChange` prop. */
  handleOverlayChange: (detail: { overlayHeight: number }) => void;
}

/**
 * Consolidates bottom-dock layout tracking for the chat panel.
 *
 * The bottom dock (`bottomDockRef`) contains the TodoListBar (above) and
 * ChatInputArea (below). Two kinds of size changes need tracking:
 *
 * 1. **In-flow changes** — TodoListBar header appears/disappears, textarea
 *    grows/shrinks. These naturally adjust the flex layout, but the message
 *    list needs to re-scroll to stay pinned to the bottom.
 *
 * 2. **Overlay changes** — TodoListBar's expanded panel is `position:absolute`
 *    and floats above the message list. The list needs extra bottom padding so
 *    the last messages aren't hidden behind it.
 *
 * This hook tracks both via a single ResizeObserver (for #1) and a callback
 * from TodoListBar (for #2), and resets `overlayInset` on conversation switch.
 *
 * @param dockRef     — ref to the always-mounted `.bottomDock` div.
 * @param watchKey    — conversation id (or null). When it changes, `overlayInset`
 *                      resets to 0 because TodoListBar remounts with fresh state.
 */
export function useBottomDockLayout(
  dockRef: RefObject<HTMLDivElement | null>,
  watchKey?: string | null
): UseBottomDockLayoutResult {
  const [overlayInset, setOverlayInset] = useState(0);
  const [resizeKey, setResizeKey] = useState(0);
  const isFirstRenderRef = useRef(true);

  const handleOverlayChange = useCallback((detail: { overlayHeight: number }) => {
    setOverlayInset(detail.overlayHeight);
  }, []);

  // Reset overlay inset on conversation switch — TodoListBar remounts collapsed.
  // resizeKey is bumped so ChatMessageList re-scrolls if needed.
  // Skipped on initial mount (no conversation switch happened).
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setOverlayInset(0);
    setResizeKey((k) => k + 1);
  }, [watchKey]);

  // Single ResizeObserver — observes the dock element itself which is always
  // mounted, so there's no need to re-attach on conversation switch.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const observer = new ResizeObserver(() => {
      setResizeKey((k) => k + 1);
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, [dockRef]);

  return { overlayInset, resizeKey, handleOverlayChange };
}
