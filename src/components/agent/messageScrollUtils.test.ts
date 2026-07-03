import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '../../types/chat';
import {
  areMessageAnchorPositionsEqual,
  computeMessageAnchorPositions,
  findPinnedUserMessage,
  getUserMessagePreviewText,
  isPinnableUserMessage,
  scrollToMessage,
} from './messageScrollUtils';

function createUserMessage(id: string, text: string): ChatMessage {
  return {
    id,
    role: 'user',
    text,
    createdAt: Date.now(),
  };
}

function mockContainer({
  top = 100,
  height = 500,
  scrollTop = 0,
  scrollHeight = 2000,
}: {
  top?: number;
  height?: number;
  scrollTop?: number;
  scrollHeight?: number;
} = {}) {
  const elements = new Map<string, HTMLElement>();

  const container = {
    scrollTop,
    scrollHeight,
    getBoundingClientRect: () => ({
      top,
      left: 0,
      right: 800,
      bottom: top + height,
      width: 800,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
    querySelector: vi.fn((selector: string) => {
      const id = selector.replace('#msg-', '');
      return elements.get(id) ?? null;
    }),
    scrollTo: vi.fn(),
  } as unknown as HTMLElement;

  return {
    container,
    setElement(id: string, rect: { top: number; bottom: number; height?: number }) {
      const element = {
        getBoundingClientRect: () => ({
          top: rect.top,
          left: 0,
          right: 800,
          bottom: rect.bottom,
          width: 800,
          height: rect.height ?? rect.bottom - rect.top,
          x: 0,
          y: rect.top,
          toJSON: () => ({}),
        }),
      } as HTMLElement;
      elements.set(id, element);
    },
  };
}

describe('messageScrollUtils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('isPinnableUserMessage accepts text or attachments', () => {
    expect(isPinnableUserMessage(createUserMessage('1', 'hello'))).toBe(true);
    expect(
      isPinnableUserMessage({
        ...createUserMessage('2', '  '),
        attachments: [{ id: 'a', type: 'image', path: '/tmp/a.png', mediaType: 'image/png', width: 100, height: 100, size: 1024, sha256: 'abc' }],
      }),
    ).toBe(true);
    expect(isPinnableUserMessage({ ...createUserMessage('3', ''), role: 'assistant' })).toBe(false);
  });

  it('findPinnedUserMessage returns null when all user messages are visible', () => {
    const { container, setElement } = mockContainer({ scrollTop: 0 });
    setElement('u1', { top: 120, bottom: 160 });
    const messages = [createUserMessage('u1', 'visible message')];

    expect(findPinnedUserMessage(messages, container, new Map())).toBeNull();
  });

  it('findPinnedUserMessage returns the scrolled-out user message', () => {
    const { container, setElement } = mockContainer({ scrollTop: 200 });
    setElement('u1', { top: 50, bottom: 90 });
    const messages = [createUserMessage('u1', 'hidden message')];

    expect(findPinnedUserMessage(messages, container, new Map())?.id).toBe('u1');
  });

  it('findPinnedUserMessage picks the closest scrolled-out message', () => {
    const { container, setElement } = mockContainer({ scrollTop: 400 });
    setElement('u1', { top: 20, bottom: 50 });
    setElement('u2', { top: 55, bottom: 85 });
    const messages = [
      createUserMessage('u1', 'older hidden'),
      createUserMessage('u2', 'closer hidden'),
    ];

    expect(findPinnedUserMessage(messages, container, new Map())?.id).toBe('u2');
  });

  it('findPinnedUserMessage falls back to layout cache when DOM is missing', () => {
    const { container } = mockContainer({ scrollTop: 300 });
    const messages = [createUserMessage('u1', 'cached hidden')];
    const cache = new Map([['u1', { offsetTop: 120, height: 40 }]]);

    expect(findPinnedUserMessage(messages, container, cache)?.id).toBe('u1');
  });

  it('scrollToMessage scrolls to the target offset', () => {
    const { container, setElement } = mockContainer({ scrollTop: 0 });
    setElement('u1', { top: 180, bottom: 220 });

    const scrolled = scrollToMessage(container, 'u1', 'auto');

    expect(scrolled).toBe(true);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 80, behavior: 'auto' });
  });

  it('scrollToMessage falls back to layout cache when DOM is missing', () => {
    const { container } = mockContainer({ scrollTop: 0 });
    const cache = new Map([['u1', { offsetTop: 156, height: 40 }]]);

    const scrolled = scrollToMessage(container, 'u1', 'smooth', cache);

    expect(scrolled).toBe(true);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 156, behavior: 'smooth' });
  });

  it('computeMessageAnchorPositions maps user messages to scroll-height percentages', () => {
    const { container, setElement } = mockContainer({ scrollTop: 100, scrollHeight: 1000 });
    setElement('u1', { top: 200, bottom: 240 });
    setElement('u2', { top: 500, bottom: 540 });
    const messages = [
      createUserMessage('u1', 'first'),
      createUserMessage('u2', 'second'),
      { ...createUserMessage('a1', 'assistant'), role: 'assistant' as const },
    ];

    expect(computeMessageAnchorPositions(messages, container, new Map())).toEqual([
      { id: 'u1', topPercent: 22 },
      { id: 'u2', topPercent: 52 },
    ]);
  });

  it('computeMessageAnchorPositions falls back to layout cache when DOM is missing', () => {
    const { container } = mockContainer({ scrollHeight: 800 });
    const messages = [createUserMessage('u1', 'cached')];
    const cache = new Map([['u1', { offsetTop: 200, height: 40 }]]);

    expect(computeMessageAnchorPositions(messages, container, cache)).toEqual([
      { id: 'u1', topPercent: 27.5 },
    ]);
  });

  it('areMessageAnchorPositionsEqual compares rounded percentages', () => {
    expect(
      areMessageAnchorPositionsEqual(
        [{ id: 'u1', topPercent: 12.34 }],
        [{ id: 'u1', topPercent: 12.33 }],
      ),
    ).toBe(true);
    expect(
      areMessageAnchorPositionsEqual(
        [{ id: 'u1', topPercent: 12.3 }],
        [{ id: 'u1', topPercent: 12.5 }],
      ),
    ).toBe(false);
  });

  it('getUserMessagePreviewText truncates long text and handles attachment-only messages', () => {
    const longText = 'a'.repeat(300);
    expect(getUserMessagePreviewText(createUserMessage('1', longText), '(attachments)')).toHaveLength(241);
    expect(
      getUserMessagePreviewText(
        {
          ...createUserMessage('2', ''),
          fileAttachments: [{ id: 'f1', path: '/tmp/a.ts', name: 'a.ts', content: 'x', language: 'typescript' }],
        },
        '(attachments)',
      ),
    ).toBe('(attachments)');
  });
});
