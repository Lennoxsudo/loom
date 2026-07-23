import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

const GAP = 6;
const VIEWPORT_PADDING = 8;

export const AGENT_SELECTOR_MENU_ATTR = 'data-agent-selector-menu';

export interface PortalMenuPosition {
  top: number;
  left: number;
  ready: boolean;
}

export function useAgentSelectorPortalMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  placement: 'above' | 'below' = 'above'
): PortalMenuPosition {
  const [position, setPosition] = useState<PortalMenuPosition>({ top: 0, left: 0, ready: false });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu?.getBoundingClientRect();
    const menuWidth = menuRect?.width ?? 140;
    const menuHeight = menuRect?.height ?? 0;

    let top = placement === 'above' ? anchorRect.top - menuHeight - GAP : anchorRect.bottom + GAP;
    let left = anchorRect.left;

    if (left + menuWidth > window.innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, anchorRect.right - menuWidth);
    }
    if (left < VIEWPORT_PADDING) {
      left = VIEWPORT_PADDING;
    }

    if (placement === 'above' && top < VIEWPORT_PADDING) {
      top = anchorRect.bottom + GAP;
    } else if (placement === 'below' && top + menuHeight > window.innerHeight - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, anchorRect.top - menuHeight - GAP);
    }

    setPosition({ top, left, ready: true });
  }, [anchorRef, menuRef, placement]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition({ top: 0, left: 0, ready: false });
      return;
    }

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);

    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open, updatePosition]);

  return position;
}

export function isAgentSelectorMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[${AGENT_SELECTOR_MENU_ATTR}]`));
}
