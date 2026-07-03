import { describe, expect, test } from 'vitest';
import {
  findPinnedChatUserMessage,
  shouldShowChatStickyOverlay,
} from './chatPinnedUserMessage';
import type { Message } from './types';

function createUserMessage(id: string, content: string): Message {
  return {
    id,
    role: 'user',
    content,
    timestamp: Date.now(),
    isStreaming: false,
  };
}

function mockContainerRect(top = 200) {
  return {
    top,
    bottom: top + 600,
    left: 0,
    right: 400,
    width: 400,
    height: 600,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('findPinnedChatUserMessage', () => {
  test('shows in-scroller pin only after the bubble leaves the viewport', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { value: 200, configurable: true });
    container.getBoundingClientRect = () => mockContainerRect(200);

    const message = createUserMessage('user-1', 'Pinned message');
    const target = document.createElement('div');
    target.id = 'msg-user-1';
    target.getBoundingClientRect = () =>
      ({
        top: 120,
        bottom: 180,
        left: 16,
        right: 384,
        width: 368,
        height: 60,
        x: 16,
        y: 120,
        toJSON: () => ({}),
      }) as DOMRect;
    container.appendChild(target);

    const pinned = findPinnedChatUserMessage([message], container, new Map(), null);
    expect(pinned?.id).toBe('user-1');
    expect(shouldShowChatStickyOverlay(message, container)).toBe(true);
  });
});
