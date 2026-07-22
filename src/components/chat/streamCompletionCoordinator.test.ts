import { describe, expect, test, vi } from 'vitest';
import {
  STREAM_COMPLETION_QUIESCENCE_MS,
  StreamCompletionCoordinator,
} from './streamCompletionCoordinator';

describe('StreamCompletionCoordinator', () => {
  test('waits for a quiet period after completion before finalizing', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const finalize = vi.fn();
    const coordinator = new StreamCompletionCoordinator(flush);

    coordinator.complete('message-1', finalize);

    expect(flush).toHaveBeenCalledWith('message-1');
    expect(finalize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STREAM_COMPLETION_QUIESCENCE_MS - 1);
    expect(finalize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith();

    vi.useRealTimers();
  });

  test('resets completion wait when a trailing chunk arrives', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const finalize = vi.fn();
    const coordinator = new StreamCompletionCoordinator(flush);

    coordinator.complete('message-1', finalize);
    vi.advanceTimersByTime(STREAM_COMPLETION_QUIESCENCE_MS - 1);

    expect(coordinator.noteChunk('message-1')).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(finalize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STREAM_COMPLETION_QUIESCENCE_MS - 1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith();

    vi.useRealTimers();
  });

  test('does not finalize after cancellation or cleanup', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const finalize = vi.fn();
    const coordinator = new StreamCompletionCoordinator(flush);

    coordinator.complete('cancelled', finalize);
    coordinator.cancel('cancelled');
    coordinator.complete('unmounted', finalize);
    coordinator.dispose();

    vi.advanceTimersByTime(STREAM_COMPLETION_QUIESCENCE_MS);

    expect(finalize).not.toHaveBeenCalled();
    expect(coordinator.noteChunk('cancelled')).toBe(false);
    expect(coordinator.noteChunk('unmounted')).toBe(false);

    vi.useRealTimers();
  });
});
