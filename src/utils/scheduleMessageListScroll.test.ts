import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  scrollContainerToBottom,
  scheduleScrollContainerToBottom,
} from './scheduleMessageListScroll';

describe('scheduleMessageListScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrollContainerToBottom sets scrollTop to max scroll height', () => {
    const element = {
      scrollHeight: 1200,
      clientHeight: 400,
      scrollTop: 0,
      scrollTo: vi.fn(),
    } as unknown as HTMLElement;

    scrollContainerToBottom(element);
    expect(element.scrollTop).toBe(800);
  });

  it('scheduleScrollContainerToBottom retries until container exists', () => {
    const containerRef = { current: null as HTMLElement | null };
    const markNearBottom = { current: false };

    scheduleScrollContainerToBottom(containerRef, { markNearBottom });

    expect(markNearBottom.current).toBe(true);

    const element = {
      scrollHeight: 900,
      clientHeight: 300,
      scrollTop: 0,
      scrollTo: vi.fn(),
    } as unknown as HTMLElement;

    containerRef.current = element;

    vi.runAllTimers();

    expect(element.scrollTop).toBe(600);
  });
});
