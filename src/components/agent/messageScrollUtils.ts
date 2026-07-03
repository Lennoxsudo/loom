import type { ChatMessage } from '../../types/chat';

export type UserMessageLayout = {
  offsetTop: number;
  height: number;
};

export type UserMessageLayoutCache = ReadonlyMap<string, UserMessageLayout>;

export type MessageAnchorPosition = {
  id: string;
  topPercent: number;
};

const SCROLL_ABOVE_THRESHOLD_PX = 4;

export function isPinnableUserMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false;
  return (
    message.text.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.fileAttachments?.length ?? 0) > 0
  );
}

export function scrollToMessage(
  container: HTMLElement,
  messageId: string,
  behavior: ScrollBehavior = 'smooth',
  layoutCache?: UserMessageLayoutCache,
): boolean {
  const selector = `#msg-${CSS.escape(messageId)}`;
  const target = container.querySelector<HTMLElement>(selector);
  if (target) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offsetTop = targetRect.top - containerRect.top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, offsetTop), behavior });
    return true;
  }

  const cached = layoutCache?.get(messageId);
  if (cached) {
    container.scrollTo({ top: Math.max(0, cached.offsetTop), behavior });
    return true;
  }

  return false;
}

export function findPinnedUserMessage(
  messages: ChatMessage[],
  container: HTMLElement,
  layoutCache: UserMessageLayoutCache,
): ChatMessage | null {
  const containerRect = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;

  let pinned: ChatMessage | null = null;
  let pinnedOffset = -Infinity;

  for (const message of messages) {
    if (!isPinnableUserMessage(message)) continue;

    const target = container.querySelector<HTMLElement>(`#msg-${message.id}`);
    if (target) {
      const rect = target.getBoundingClientRect();
      const offsetTop = rect.top - containerRect.top + scrollTop;
      if (rect.bottom < containerRect.top - SCROLL_ABOVE_THRESHOLD_PX && offsetTop > pinnedOffset) {
        pinnedOffset = offsetTop;
        pinned = message;
      }
      continue;
    }

    const cached = layoutCache.get(message.id);
    if (!cached) continue;

    const bottom = cached.offsetTop + cached.height;
    if (bottom < scrollTop + SCROLL_ABOVE_THRESHOLD_PX && cached.offsetTop > pinnedOffset) {
      pinnedOffset = cached.offsetTop;
      pinned = message;
    }
  }

  return pinned;
}

export function computeMessageAnchorPositions(
  messages: ChatMessage[],
  container: HTMLElement,
  layoutCache: UserMessageLayoutCache,
): MessageAnchorPosition[] {
  const scrollHeight = container.scrollHeight;
  if (scrollHeight <= 0) return [];

  const containerRect = container.getBoundingClientRect();
  const positions: MessageAnchorPosition[] = [];

  for (const message of messages) {
    if (message.role !== 'user' || message.text.trim().length === 0) continue;

    let offsetTop: number | null = null;
    let height = 0;

    const target = container.querySelector<HTMLElement>(`#msg-${CSS.escape(message.id)}`);
    if (target) {
      const rect = target.getBoundingClientRect();
      offsetTop = rect.top - containerRect.top + container.scrollTop;
      height = rect.height;
    } else {
      const cached = layoutCache.get(message.id);
      if (cached) {
        offsetTop = cached.offsetTop;
        height = cached.height;
      }
    }

    if (offsetTop == null) continue;

    positions.push({
      id: message.id,
      topPercent: Math.round(((offsetTop + height / 2) / scrollHeight) * 1000) / 10,
    });
  }

  return positions;
}

function roundAnchorTop(top: number): number {
  return Math.round(top * 10) / 10;
}

export function areMessageAnchorPositionsEqual(
  a: MessageAnchorPosition[],
  b: MessageAnchorPosition[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (roundAnchorTop(a[i].topPercent) !== roundAnchorTop(b[i].topPercent)) return false;
  }
  return true;
}

export function getUserMessagePreviewText(
  message: ChatMessage,
  attachmentOnlyLabel: string,
  maxLength = 240,
): string {
  const trimmed = message.text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 0) {
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, maxLength)}…`;
  }

  if ((message.attachments?.length ?? 0) > 0 || (message.fileAttachments?.length ?? 0) > 0) {
    return attachmentOnlyLabel;
  }

  return '';
}
