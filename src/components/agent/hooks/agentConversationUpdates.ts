import type {
  AgentConversation,
  AgentConversationState,
  ChatMessage,
} from '../../../types/chat';

/**
 * Immutably update a single message inside a conversation.
 * Sets the conversation's updatedAt to Date.now() when a match is found.
 * Returns the input state unchanged when conversationId or messageId does not match.
 */
export function updateAgentMessageById(
  state: AgentConversationState,
  conversationId: string,
  messageId: string,
  updater: (msg: ChatMessage) => ChatMessage,
  options?: { touchUpdatedAt?: boolean }
): AgentConversationState {
  const convIndex = state.conversations.findIndex((conv) => conv.id === conversationId);
  if (convIndex === -1) {
    return state;
  }

  const conversation = state.conversations[convIndex];
  const msgIndex = conversation.messages.findIndex((msg) => msg.id === messageId);
  if (msgIndex === -1) {
    return state;
  }

  const previousMessage = conversation.messages[msgIndex];
  const updatedMessage = updater(previousMessage);
  if (updatedMessage === previousMessage) {
    return state;
  }
  const nextMessages = conversation.messages.slice();
  nextMessages[msgIndex] = updatedMessage;

  const nextConversation: AgentConversation = {
    ...conversation,
    updatedAt: options?.touchUpdatedAt === false ? conversation.updatedAt : Date.now(),
    messages: nextMessages,
  };

  const nextConversations = state.conversations.slice();
  nextConversations[convIndex] = nextConversation;

  return {
    ...state,
    conversations: nextConversations,
  };
}

/**
 * Immutably update a conversation by id (title, contextInjected, messages array, etc.).
 * Returns the input state unchanged when conversationId does not match.
 */
export function updateAgentConversationById(
  state: AgentConversationState,
  conversationId: string,
  updater: (conv: AgentConversation) => AgentConversation
): AgentConversationState {
  const convIndex = state.conversations.findIndex((conv) => conv.id === conversationId);
  if (convIndex === -1) {
    return state;
  }

  const updatedConversation = updater(state.conversations[convIndex]);
  if (updatedConversation === state.conversations[convIndex]) {
    return state;
  }

  const nextConversations = state.conversations.slice();
  nextConversations[convIndex] = updatedConversation;

  return {
    ...state,
    conversations: nextConversations,
  };
}
