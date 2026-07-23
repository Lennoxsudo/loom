import type { UserMessageLayoutCache } from '../agent/messageScrollUtils';
import type { Message } from './types';

const SCROLL_ABOVE_THRESHOLD_PX = 4;
const UNPIN_HYSTERESIS_PX = 40;

export function isPinnableChatUserMessage(message: Message): boolean {
  if (message.role !== 'user') return false;
  return message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0;
}

export function getChatUserMessagePreviewText(
  message: Message,
  attachmentOnlyLabel: string,
  fileContextPrefix?: string,
  maxLength = 240
): string {
  let text = message.content;
  if (fileContextPrefix && text.startsWith(fileContextPrefix)) {
    const splitIndex = text.lastIndexOf('\n---\n\n');
    if (splitIndex !== -1) {
      text = text.substring(splitIndex + 6);
    }
  }

  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 0) {
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, maxLength)}…`;
  }

  if ((message.attachments?.length ?? 0) > 0) {
    return attachmentOnlyLabel;
  }

  return '';
}

function qualifiesAsPinnedDomRect(
  rect: DOMRect,
  containerTop: number,
  isCurrentPinned: boolean
): boolean {
  if (isCurrentPinned) {
    return rect.bottom < containerTop + UNPIN_HYSTERESIS_PX;
  }

  const isStickingAtTop = rect.top < containerTop && rect.bottom > containerTop;
  const isFullyAbove = rect.bottom < containerTop - SCROLL_ABOVE_THRESHOLD_PX;
  return isStickingAtTop || isFullyAbove;
}

function qualifiesAsPinnedCachedLayout(
  offsetTop: number,
  height: number,
  scrollTop: number,
  isCurrentPinned: boolean
): boolean {
  const bottom = offsetTop + height;

  if (isCurrentPinned) {
    return bottom < scrollTop + UNPIN_HYSTERESIS_PX;
  }

  const isStickingAtTop = offsetTop < scrollTop && bottom > scrollTop;
  const isFullyAbove = bottom < scrollTop + SCROLL_ABOVE_THRESHOLD_PX;
  return isStickingAtTop || isFullyAbove;
}

export function findPinnedChatUserMessage(
  messages: Message[],
  container: HTMLElement,
  layoutCache: UserMessageLayoutCache,
  currentPinnedId: string | null = null
): Message | null {
  const containerRect = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;

  let pinned: Message | null = null;
  let pinnedOffset = -Infinity;

  for (const message of messages) {
    if (!isPinnableChatUserMessage(message)) continue;

    const isCurrentPinned = message.id === currentPinnedId;
    const target = container.querySelector<HTMLElement>(`#msg-${CSS.escape(message.id)}`);
    if (target) {
      const rect = target.getBoundingClientRect();
      const offsetTop = rect.top - containerRect.top + scrollTop;
      if (
        qualifiesAsPinnedDomRect(rect, containerRect.top, isCurrentPinned) &&
        offsetTop > pinnedOffset
      ) {
        pinnedOffset = offsetTop;
        pinned = message;
      }
      continue;
    }

    const cached = layoutCache.get(message.id);
    if (!cached) continue;

    if (
      qualifiesAsPinnedCachedLayout(cached.offsetTop, cached.height, scrollTop, isCurrentPinned) &&
      cached.offsetTop > pinnedOffset
    ) {
      pinnedOffset = cached.offsetTop;
      pinned = message;
    }
  }

  return pinned;
}

/** Show in-scroller pin only after the source bubble has left the viewport. */
export function shouldShowChatStickyOverlay(pinned: Message, container: HTMLElement): boolean {
  const target = container.querySelector<HTMLElement>(`#msg-${CSS.escape(pinned.id)}`);
  if (!target) return true;

  const containerRect = container.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  return rect.bottom <= containerRect.top;
}
