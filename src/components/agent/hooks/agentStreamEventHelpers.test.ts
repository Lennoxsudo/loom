import { describe, expect, it, vi } from 'vitest';
import {
  appendExecutedToolToMessage,
  buildThinkingEndedPatch,
  flushQueuedChunksForMessageIfNeeded,
} from './agentStreamEventHelpers';

describe('buildThinkingEndedPatch', () => {
  it('ends thinking timer when thinking is active', () => {
    const patch = buildThinkingEndedPatch(
      { thinking: 'planning...', thinkingEndedAt: undefined },
      1_700_000_000_000
    );
    expect(patch).toEqual({ thinkingEndedAt: 1_700_000_000_000, isThinking: false });
  });

  it('returns empty patch when thinking already ended', () => {
    expect(
      buildThinkingEndedPatch({ thinking: 'done', thinkingEndedAt: 123 })
    ).toEqual({});
  });

  it('returns empty patch when there is no thinking content', () => {
    expect(buildThinkingEndedPatch({ thinking: undefined })).toEqual({});
  });
});

describe('appendExecutedToolToMessage', () => {
  it('only appends executedTools without ending thinking or changing streaming state', () => {
    const msg = {
      id: 'msg-1',
      thinking: 'planning',
      thinkingEndedAt: undefined as number | undefined,
      isStreaming: true,
      isProcessingTools: false,
      executedTools: [] as Array<{ tool_name: string; tool_call_id: string; result_preview: string; success: boolean; round: number; total_rounds_so_far: number }>,
    };

    const patched = appendExecutedToolToMessage(msg, {
      tool_name: 'read_file',
      tool_call_id: 'call-1',
      result_preview: 'README',
      success: true,
      round: 1,
      total_rounds_so_far: 1,
    });

    expect(patched.executedTools).toHaveLength(1);
    expect(patched.thinkingEndedAt).toBeUndefined();
    expect(patched.isStreaming).toBe(true);
    expect(patched.isProcessingTools).toBe(false);
  });
});

describe('flushQueuedChunksForMessageIfNeeded', () => {
  it('flushes when the message still has queued chunks', () => {
    const flush = vi.fn();
    flushQueuedChunksForMessageIfNeeded('msg-1', (id) => id === 'msg-1', flush);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('skips flush when the queue is empty for that message', () => {
    const flush = vi.fn();
    flushQueuedChunksForMessageIfNeeded('msg-1', () => false, flush);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('stream complete drain contract', () => {
  it('always flushes all queued chunks before finalize (sync drain)', () => {
    const flush = vi.fn();
    const finalize = vi.fn();

    flush();
    finalize();

    expect(flush).toHaveBeenCalledBefore(finalize);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });
});
