import { describe, expect, it, vi, afterEach } from 'vitest';
import type { AgentConversationState, ChatMessage } from '../../../types/chat';
import { updateAgentConversationById, updateAgentMessageById } from './agentConversationUpdates';

function makeMessage(id: string, text = ''): ChatMessage {
  return {
    id,
    role: 'assistant',
    text,
    createdAt: 1,
  };
}

function makeConversation(
  id: string,
  messages: ChatMessage[],
  updatedAt = 100
): AgentConversationState['conversations'][number] {
  return {
    id,
    title: id,
    messages,
    previewHistory: [],
    currentPreviewIndex: 0,
    createdAt: 1,
    updatedAt,
  };
}

function makeState(conversations: AgentConversationState['conversations']): AgentConversationState {
  return {
    selectedConversationId: conversations[0]?.id ?? null,
    conversations,
  };
}

describe('updateAgentMessageById', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates the matching message and conversation updatedAt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9_999);
    const msgA = makeMessage('a', 'before');
    const msgB = makeMessage('b', 'other');
    const conv1 = makeConversation('conv-1', [msgA, msgB], 100);
    const conv2 = makeConversation('conv-2', [makeMessage('x')], 200);
    const state = makeState([conv1, conv2]);

    const next = updateAgentMessageById(state, 'conv-1', 'a', (msg) => ({
      ...msg,
      text: 'after',
    }));

    expect(next).not.toBe(state);
    expect(next.conversations).not.toBe(state.conversations);
    expect(next.conversations[0]).not.toBe(state.conversations[0]);
    expect(next.conversations[0].updatedAt).toBe(9_999);
    expect(next.conversations[0].messages[0].text).toBe('after');
    expect(next.conversations[0].messages[1]).toBe(msgB);
    expect(next.conversations[1]).toBe(conv2);
  });

  it('returns the same state reference when conversationId is missing', () => {
    const state = makeState([makeConversation('conv-1', [makeMessage('a')])]);
    const next = updateAgentMessageById(state, 'missing', 'a', (msg) => ({
      ...msg,
      text: 'nope',
    }));
    expect(next).toBe(state);
  });

  it('returns the same state reference when messageId is missing', () => {
    const state = makeState([makeConversation('conv-1', [makeMessage('a')])]);
    const next = updateAgentMessageById(state, 'conv-1', 'missing', (msg) => ({
      ...msg,
      text: 'nope',
    }));
    expect(next).toBe(state);
  });

  it('does not mutate the input state', () => {
    const msg = makeMessage('a', 'before');
    const conv = makeConversation('conv-1', [msg], 100);
    const state = makeState([conv]);
    const snapshot = JSON.stringify(state);

    updateAgentMessageById(state, 'conv-1', 'a', (m) => ({ ...m, text: 'after' }));

    expect(JSON.stringify(state)).toBe(snapshot);
    expect(msg.text).toBe('before');
    expect(conv.updatedAt).toBe(100);
  });
});

describe('updateAgentConversationById', () => {
  it('updates the matching conversation', () => {
    const conv1 = makeConversation('conv-1', [makeMessage('a')], 100);
    const conv2 = makeConversation('conv-2', [makeMessage('b')], 200);
    const state = makeState([conv1, conv2]);

    const next = updateAgentConversationById(state, 'conv-1', (conv) => ({
      ...conv,
      title: 'new-title',
      titleGenerated: true,
    }));

    expect(next).not.toBe(state);
    expect(next.conversations[0].title).toBe('new-title');
    expect(next.conversations[0].titleGenerated).toBe(true);
    expect(next.conversations[0].messages).toBe(conv1.messages);
    expect(next.conversations[1]).toBe(conv2);
  });

  it('returns the same state reference when conversationId is missing', () => {
    const state = makeState([makeConversation('conv-1', [makeMessage('a')])]);
    const next = updateAgentConversationById(state, 'missing', (conv) => ({
      ...conv,
      title: 'nope',
    }));
    expect(next).toBe(state);
  });

  it('returns the same state reference when updater returns the same conversation reference', () => {
    const conv = makeConversation('conv-1', [makeMessage('a')]);
    const state = makeState([conv]);
    const next = updateAgentConversationById(state, 'conv-1', (c) => c);
    expect(next).toBe(state);
  });

  it('does not mutate the input state', () => {
    const conv = makeConversation('conv-1', [makeMessage('a')], 100);
    const state = makeState([conv]);
    const snapshot = JSON.stringify(state);

    updateAgentConversationById(state, 'conv-1', (c) => ({
      ...c,
      title: 'changed',
    }));

    expect(JSON.stringify(state)).toBe(snapshot);
    expect(conv.title).toBe('conv-1');
  });
});
