function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

export interface SmoothScrollToBottomOptions {
  duration?: number;
  onComplete?: () => void;
}

export function smoothScrollToBottom(
  element: HTMLElement,
  options?: SmoothScrollToBottomOptions
): () => void {
  const startTop = element.scrollTop;
  const targetTop = Math.max(element.scrollHeight - element.clientHeight, 0);
  const distance = targetTop - startTop;

  if (Math.abs(distance) < 1) {
    element.scrollTop = targetTop;
    options?.onComplete?.();
    return () => {};
  }

  const duration = options?.duration ?? Math.min(720, Math.max(320, Math.abs(distance) * 0.45));
  const startTime = performance.now();
  let frameId = 0;

  const cancel = () => {
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  };

  const step = (now: number) => {
    const progress = Math.min((now - startTime) / duration, 1);
    element.scrollTop = startTop + distance * easeOutCubic(progress);

    if (progress < 1) {
      frameId = requestAnimationFrame(step);
      return;
    }

    element.scrollTop = targetTop;
    frameId = 0;
    options?.onComplete?.();
  };

  frameId = requestAnimationFrame(step);
  return cancel;
}
