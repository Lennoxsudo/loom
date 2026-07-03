import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { useBottomDockLayout } from './useBottomDockLayout';

type ROCallback = ResizeObserverCallback;

let lastCallback: ROCallback | null = null;

class MockResizeObserver {
  constructor(callback: ROCallback) {
    lastCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function createRef(): React.RefObject<HTMLDivElement | null> {
  return { current: document.createElement('div') };
}

describe('useBottomDockLayout', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    lastCallback = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('initial state has zero overlayInset and zero resizeKey', () => {
    const ref = createRef();
    const { result } = renderHook(() => useBottomDockLayout(ref, 'conv-1'));

    expect(result.current.overlayInset).toBe(0);
    expect(result.current.resizeKey).toBe(0);
  });

  test('handleOverlayChange updates overlayInset', () => {
    const ref = createRef();
    const { result } = renderHook(() => useBottomDockLayout(ref, 'conv-1'));

    act(() => {
      result.current.handleOverlayChange({ overlayHeight: 120 });
    });

    expect(result.current.overlayInset).toBe(120);
  });

  test('handleOverlayChange to 0 when panel collapses', () => {
    const ref = createRef();
    const { result } = renderHook(() => useBottomDockLayout(ref, 'conv-1'));

    act(() => {
      result.current.handleOverlayChange({ overlayHeight: 80 });
    });
    expect(result.current.overlayInset).toBe(80);

    act(() => {
      result.current.handleOverlayChange({ overlayHeight: 0 });
    });
    expect(result.current.overlayInset).toBe(0);
  });

  test('ResizeObserver fires and increments resizeKey', () => {
    const ref = createRef();
    const { result } = renderHook(() => useBottomDockLayout(ref, 'conv-1'));

    expect(lastCallback).not.toBeNull();

    act(() => {
      lastCallback!([], {} as ResizeObserver);
    });

    expect(result.current.resizeKey).toBe(1);

    act(() => {
      lastCallback!([], {} as ResizeObserver);
      lastCallback!([], {} as ResizeObserver);
    });

    expect(result.current.resizeKey).toBe(3);
  });

  test('watchKey change resets overlayInset and bumps resizeKey', () => {
    const ref = createRef();
    const { result, rerender } = renderHook(
      ({ watchKey }) => useBottomDockLayout(ref, watchKey),
      { initialProps: { watchKey: 'conv-1' as string | null } }
    );

    act(() => {
      result.current.handleOverlayChange({ overlayHeight: 200 });
    });
    expect(result.current.overlayInset).toBe(200);

    // Switch conversation
    rerender({ watchKey: 'conv-2' });

    expect(result.current.overlayInset).toBe(0);
    // resizeKey should have bumped from the reset effect
    expect(result.current.resizeKey).toBeGreaterThanOrEqual(1);
  });

  test('handleOverlayChange is stable across re-renders', () => {
    const ref = createRef();
    const { result, rerender } = renderHook(() => useBottomDockLayout(ref, 'conv-1'));

    const first = result.current.handleOverlayChange;
    rerender();
    expect(result.current.handleOverlayChange).toBe(first);
  });

  test('null dock ref does not throw', () => {
    const ref: React.RefObject<HTMLDivElement | null> = { current: null };
    const { result } = renderHook(() => useBottomDockLayout(ref, 'conv-1'));

    expect(result.current.overlayInset).toBe(0);
    expect(result.current.resizeKey).toBe(0);
  });

  test('null watchKey works without errors', () => {
    const ref = createRef();
    const { result, rerender } = renderHook(
      ({ watchKey }) => useBottomDockLayout(ref, watchKey),
      { initialProps: { watchKey: null as string | null } }
    );

    act(() => {
      result.current.handleOverlayChange({ overlayHeight: 50 });
    });
    expect(result.current.overlayInset).toBe(50);

    // Switch from null to a conversation
    rerender({ watchKey: 'conv-1' });
    expect(result.current.overlayInset).toBe(0);
  });
});
