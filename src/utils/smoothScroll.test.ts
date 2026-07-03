import { describe, expect, it, vi } from 'vitest';
import { smoothScrollToBottom } from './smoothScroll';

describe('smoothScrollToBottom', () => {
  it('snaps to bottom when already at the target', () => {
    const element = {
      scrollTop: 800,
      scrollHeight: 1000,
      clientHeight: 200,
    } as HTMLElement;

    const onComplete = vi.fn();
    smoothScrollToBottom(element, { onComplete });

    expect(element.scrollTop).toBe(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
