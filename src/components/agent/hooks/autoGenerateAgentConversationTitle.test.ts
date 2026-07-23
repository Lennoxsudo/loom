import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { AgentConversationState } from '../../../types/chat';
import {
  autoGenerateAgentConversationTitle,
  buildInstantAgentConversationTitle,
  hasInvalidGeneratedAgentTitle,
  isAgentConversationEligibleForTitleUpdate,
  shouldAutoGenerateAgentTitle,
} from './autoGenerateAgentConversationTitle';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function createState(
  conversation: AgentConversationState['conversations'][number]
): AgentConversationState {
  return {
    selectedConversationId: conversation.id,
    conversations: [conversation],
  };
}

describe('buildInstantAgentConversationTitle', () => {
  it('truncates long user text', () => {
    expect(buildInstantAgentConversationTitle('fix title issue quickly')).toBe(
      'fix title issue...'
    );
  });

  it('uses first file name when text is empty', () => {
    expect(buildInstantAgentConversationTitle('', ['src/main.ts'])).toBe('关于 src/main.ts');
  });

  it('falls back to default title when input is empty', () => {
    expect(buildInstantAgentConversationTitle('   ')).toBe('会话');
  });
});

describe('shouldAutoGenerateAgentTitle', () => {
  it('returns true for first message on a new conversation', () => {
    expect(
      shouldAutoGenerateAgentTitle({
        titleGenerated: false,
        title: '会话',
        preSendMessageCount: 0,
      })
    ).toBe(true);
  });

  it('returns false after initial messages', () => {
    expect(
      shouldAutoGenerateAgentTitle({
        titleGenerated: false,
        title: '会话',
        preSendMessageCount: 2,
      })
    ).toBe(false);
  });

  it('returns true when title contains thinking tags', () => {
    expect(
      shouldAutoGenerateAgentTitle({
        titleGenerated: true,
        title: '<thinking>oops</thinking>',
        preSendMessageCount: 0,
      })
    ).toBe(true);
  });
});

describe('hasInvalidGeneratedAgentTitle', () => {
  it('detects think/thinking tags', () => {
    expect(hasInvalidGeneratedAgentTitle('normal title')).toBe(false);
    expect(hasInvalidGeneratedAgentTitle('oops')).toBe(false);
    expect(hasInvalidGeneratedAgentTitle('<thinking>oops</thinking>')).toBe(true);
  });
});

describe('autoGenerateAgentConversationTitle', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('dedupes title generation for the same conversation', async () => {
    invokeMock.mockResolvedValue('Generated title');

    const autoTitleRequestedRef = { current: new Set<string>() };
    let state = createState({
      id: 'conv-1',
      title: 'hello',
      projectPath: 'D:/project',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      previewHistory: [],
      currentPreviewIndex: 0,
      titleGenerated: false,
    });
    const conversationStateRef = {
      current: state,
    };
    const setConversationState = vi.fn(
      (updater: typeof state | ((prev: typeof state) => typeof state)) => {
        state = typeof updater === 'function' ? updater(state) : updater;
        conversationStateRef.current = state;
      }
    );

    const options = {
      conversationId: 'conv-1',
      provider: 'openai' as const,
      model: 'gpt-4o-mini',
      userText: 'hello',
      fileNames: [],
      autoTitleRequestedRef,
      conversationStateRef,
      setConversationState,
    };

    await Promise.all([
      autoGenerateAgentConversationTitle(options),
      autoGenerateAgentConversationTitle(options),
    ]);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(state.conversations[0].title).toBe('Generated title');
    expect(state.conversations[0].titleGenerated).toBe(true);
  });

  it('marks titleGenerated when generation fails', async () => {
    invokeMock.mockRejectedValue(new Error('title failed'));

    let state = createState({
      id: 'conv-1',
      title: 'hello',
      projectPath: 'D:/project',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      previewHistory: [],
      currentPreviewIndex: 0,
      titleGenerated: false,
    });
    const conversationStateRef = { current: state };
    const setConversationState = vi.fn(
      (updater: typeof state | ((prev: typeof state) => typeof state)) => {
        state = typeof updater === 'function' ? updater(state) : updater;
        conversationStateRef.current = state;
      }
    );

    await autoGenerateAgentConversationTitle({
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      userText: 'hello',
      fileNames: [],
      autoTitleRequestedRef: { current: new Set<string>() },
      conversationStateRef,
      setConversationState,
    });

    expect(state.conversations[0].titleGenerated).toBe(true);
    expect(state.conversations[0].title).toBe('hello');
  });

  it('does not overwrite title when conversation is no longer initial', async () => {
    invokeMock.mockResolvedValue('Late title');

    let state = createState({
      id: 'conv-1',
      title: 'Existing title',
      projectPath: 'D:/project',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: 'u1', role: 'user', text: 'one', createdAt: 1 },
        { id: 'a1', role: 'assistant', text: 'two', createdAt: 2 },
        { id: 'u2', role: 'user', text: 'three', createdAt: 3 },
        { id: 'a2', role: 'assistant', text: 'four', createdAt: 4 },
      ],
      previewHistory: [],
      currentPreviewIndex: 0,
      titleGenerated: false,
    });
    const conversationStateRef = { current: state };
    const setConversationState = vi.fn(
      (updater: typeof state | ((prev: typeof state) => typeof state)) => {
        state = typeof updater === 'function' ? updater(state) : updater;
        conversationStateRef.current = state;
      }
    );

    await autoGenerateAgentConversationTitle({
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      userText: 'hello',
      fileNames: [],
      autoTitleRequestedRef: { current: new Set<string>() },
      conversationStateRef,
      setConversationState,
    });

    expect(isAgentConversationEligibleForTitleUpdate(state.conversations[0])).toBe(false);
    expect(state.conversations[0].title).toBe('Existing title');
    expect(state.conversations[0].titleGenerated).toBe(true);
  });
});
