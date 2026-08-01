import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePersistedComposerDraft } from './usePersistedComposerDraft';
import { buildComposeDraftSessionKey, resolveDraftSessionKey } from '../utils';

describe('usePersistedComposerDraft', () => {
  it('does not write the previous thread draft into compose on session switch', () => {
    const drafts: Record<string, string> = {
      [resolveDraftSessionKey('proj', 'thread-a')]: 'thread draft',
    };
    const loadDraftForSession = vi.fn((key: string) => drafts[key] ?? '');
    const saveDraftForSession = vi.fn((key: string, draft: string) => {
      const trimmed = draft.trim();
      if (trimmed) {
        drafts[key] = draft;
      } else {
        delete drafts[key];
      }
    });
    const setDraftMessage = vi.fn();

    const { rerender } = renderHook(
      ({ selectedThreadId, draft }) =>
        usePersistedComposerDraft({
          extrasLoaded: true,
          activeProjectKey: 'proj',
          selectedThreadId,
          draftMessage: draft,
          setDraftMessage,
          loadDraftForSession,
          saveDraftForSession,
        }),
      {
        initialProps: {
          selectedThreadId: 'thread-a' as string | null,
          draft: 'thread draft',
        },
      }
    );

    // First mount hydrates the thread session (no save).
    expect(loadDraftForSession).toHaveBeenCalledWith(resolveDraftSessionKey('proj', 'thread-a'));
    expect(saveDraftForSession).not.toHaveBeenCalled();

    // User edits draft on the thread — should persist to that thread only.
    act(() => {
      rerender({ selectedThreadId: 'thread-a', draft: 'typed in thread' });
    });
    expect(saveDraftForSession).toHaveBeenCalledWith(
      resolveDraftSessionKey('proj', 'thread-a'),
      'typed in thread'
    );
    saveDraftForSession.mockClear();
    setDraftMessage.mockClear();

    // Simulate "new session": selection → compose with empty storage.
    // Stale in-memory draft still present for one frame (the bug trigger).
    delete drafts[buildComposeDraftSessionKey('proj')];

    act(() => {
      rerender({ selectedThreadId: null, draft: 'typed in thread' });
    });

    expect(loadDraftForSession).toHaveBeenCalledWith(buildComposeDraftSessionKey('proj'));
    expect(setDraftMessage).toHaveBeenCalledWith('');
    expect(saveDraftForSession).not.toHaveBeenCalled();
    expect(drafts[buildComposeDraftSessionKey('proj')]).toBeUndefined();
  });

  it('saves draft edits for the active session after hydration', () => {
    const drafts: Record<string, string> = {};
    const loadDraftForSession = vi.fn((key: string) => drafts[key] ?? '');
    const saveDraftForSession = vi.fn((key: string, draft: string) => {
      if (draft.trim()) drafts[key] = draft;
      else delete drafts[key];
    });

    const { rerender } = renderHook(
      ({ draft }) =>
        usePersistedComposerDraft({
          extrasLoaded: true,
          activeProjectKey: 'proj',
          selectedThreadId: null,
          draftMessage: draft,
          setDraftMessage: vi.fn(),
          loadDraftForSession,
          saveDraftForSession,
        }),
      { initialProps: { draft: '' } }
    );

    act(() => {
      rerender({ draft: 'hello compose' });
    });

    expect(saveDraftForSession).toHaveBeenCalledWith(
      buildComposeDraftSessionKey('proj'),
      'hello compose'
    );
  });
});
