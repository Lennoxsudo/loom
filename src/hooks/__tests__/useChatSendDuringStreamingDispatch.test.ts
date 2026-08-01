import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatSendDuringStreamingDispatch } from '../useChatSendDuringStreamingDispatch';

function createHarness(options?: {
  scopeKey?: string | null;
  mode?: 'queue' | 'interrupt';
  isStreamingBusy?: boolean;
}) {
  const sendMessage = vi.fn(async () => undefined);
  const stopStreaming = vi.fn(async () => undefined);
  const clearComposer = vi.fn();
  const restoreComposer = vi.fn();
  let inputValue = 'hello';

  const hook = renderHook(
    (props: {
      scopeKey: string | null;
      isStreamingBusy: boolean;
      isStopping: boolean;
    }) =>
      useChatSendDuringStreamingDispatch({
        mode: options?.mode ?? 'queue',
        isStreamingBusy: props.isStreamingBusy,
        isStopping: props.isStopping,
        hasInput: inputValue.trim().length > 0,
        canSendWhileIdle: true,
        snapshotComposer: () => ({
          inputValue,
          attachedFiles: [],
          attachedImages: [],
        }),
        clearComposer: () => {
          inputValue = '';
          clearComposer();
        },
        restoreComposer: (payload) => {
          inputValue = payload.inputValue;
          restoreComposer(payload);
        },
        sendMessage,
        stopStreaming,
        toSendOverrides: (payload) => payload,
        scopeKey: props.scopeKey,
      }),
    {
      initialProps: {
        scopeKey: options?.scopeKey ?? 'conv-a',
        isStreamingBusy: options?.isStreamingBusy ?? true,
        isStopping: false,
      },
    }
  );

  return {
    hook,
    sendMessage,
    clearComposer,
    setInputValue: (value: string) => {
      inputValue = value;
    },
  };
}

describe('useChatSendDuringStreamingDispatch scopeKey', () => {
  it('keeps queued messages isolated per conversation', async () => {
    const { hook, clearComposer } = createHarness({
      scopeKey: 'conv-a',
      isStreamingBusy: true,
    });

    await act(async () => {
      await hook.result.current.dispatchComposerSend();
    });
    expect(clearComposer).toHaveBeenCalled();
    expect(hook.result.current.queuedMessages).toHaveLength(1);
    expect(hook.result.current.queuedMessages[0]?.inputValue).toBe('hello');

    act(() => {
      hook.rerender({ scopeKey: 'conv-b', isStreamingBusy: true, isStopping: false });
    });
    expect(hook.result.current.queuedMessages).toHaveLength(0);

    act(() => {
      hook.rerender({ scopeKey: 'conv-a', isStreamingBusy: true, isStopping: false });
    });
    expect(hook.result.current.queuedMessages).toHaveLength(1);
    expect(hook.result.current.queuedMessages[0]?.inputValue).toBe('hello');
  });

  it('does not flush another conversation queue into the current idle thread', async () => {
    const { hook, sendMessage, setInputValue } = createHarness({
      scopeKey: 'conv-a',
      isStreamingBusy: true,
    });

    await act(async () => {
      await hook.result.current.dispatchComposerSend();
    });
    expect(hook.result.current.queuedMessages).toHaveLength(1);

    setInputValue('');
    act(() => {
      // Switch to an idle conversation — must not send the previous thread's queue.
      hook.rerender({ scopeKey: 'conv-b', isStreamingBusy: false, isStopping: false });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(hook.result.current.queuedMessages).toHaveLength(0);

    act(() => {
      hook.rerender({ scopeKey: 'conv-a', isStreamingBusy: false, isStopping: false });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ inputValue: 'hello' }));
  });
});
