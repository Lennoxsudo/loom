import { invoke } from '@tauri-apps/api/core';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AIProvider } from '../../../utils/agentPersistence';
import type { AgentConversation, AgentConversationState } from '../../../types/chat';
import { normalizeGeneratedTitle } from '../utils';
import { updateAgentConversationById } from './agentConversationUpdates';

const INVALID_TITLE_PATTERN = /<\/?\s*(think|thinking)\b/i;
const DEFAULT_AGENT_CONVERSATION_TITLE = '会话';
const INSTANT_TITLE_MAX_CHARS = 15;

export function buildInstantAgentConversationTitle(
  userText: string,
  fileNames: string[] = []
): string {
  const cleanedFileNames = fileNames.map((name) => name.trim()).filter((name) => name.length > 0);
  if (cleanedFileNames.length > 0) {
    return `关于 ${cleanedFileNames[0]}`;
  }

  const trimmedText = userText.trim();
  if (!trimmedText) {
    return DEFAULT_AGENT_CONVERSATION_TITLE;
  }

  const chars = Array.from(trimmedText);
  if (chars.length <= INSTANT_TITLE_MAX_CHARS) {
    return trimmedText;
  }

  return `${chars.slice(0, INSTANT_TITLE_MAX_CHARS).join('')}...`;
}

export function hasInvalidGeneratedAgentTitle(title: string | undefined): boolean {
  return INVALID_TITLE_PATTERN.test(title || '');
}

export function shouldAutoGenerateAgentTitle(options: {
  titleGenerated?: boolean;
  title?: string;
  preSendMessageCount: number;
}): boolean {
  const { titleGenerated, title, preSendMessageCount } = options;
  const isInitialMessage = preSendMessageCount <= 1;
  const needsTitle = !titleGenerated || hasInvalidGeneratedAgentTitle(title);
  return isInitialMessage && needsTitle;
}

export function isAgentConversationEligibleForTitleUpdate(
  conversation: AgentConversation | null | undefined
): boolean {
  if (!conversation) return false;
  if (conversation.messages.length > 3) return false;
  if (conversation.titleGenerated && !hasInvalidGeneratedAgentTitle(conversation.title)) {
    return false;
  }
  return true;
}

export interface AutoGenerateAgentConversationTitleOptions {
  conversationId: string;
  provider: AIProvider;
  model: string;
  profileId?: string;
  userText: string;
  fileNames: string[];
  autoTitleRequestedRef: MutableRefObject<Set<string>>;
  conversationStateRef: MutableRefObject<AgentConversationState>;
  setConversationState: Dispatch<SetStateAction<AgentConversationState>>;
}

export async function autoGenerateAgentConversationTitle(
  options: AutoGenerateAgentConversationTitleOptions
): Promise<void> {
  const {
    conversationId,
    provider,
    model,
    profileId,
    userText,
    fileNames,
    autoTitleRequestedRef,
    conversationStateRef,
    setConversationState,
  } = options;

  if (autoTitleRequestedRef.current.has(conversationId)) return;
  autoTitleRequestedRef.current.add(conversationId);

  const trimmedUserText = userText.trim();
  const cleanedFileNames = fileNames.map((name) => name.trim()).filter((name) => name.length > 0);
  const titleContext =
    trimmedUserText ||
    (cleanedFileNames.length > 0
      ? `（无文本，相关文件：${cleanedFileNames.join('、')}）`
      : '（无文本）');

  const markTitleGenerated = () => {
    setConversationState((prev) =>
      updateAgentConversationById(prev, conversationId, (conv) => ({
        ...conv,
        titleGenerated: true,
      }))
    );
  };

  try {
    const raw = await invoke<string>('generate_conversation_title', {
      provider,
      model,
      userText: titleContext,
      fileNames: cleanedFileNames.length > 0 ? cleanedFileNames : null,
      profileId,
    });

    const cleanTitle = normalizeGeneratedTitle(raw);

    let latestConversation = conversationStateRef.current?.conversations.find(
      (conv) => conv.id === conversationId
    );

    if (!latestConversation) {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        latestConversation = conversationStateRef.current?.conversations.find(
          (conv) => conv.id === conversationId
        );
        if (latestConversation) break;
      }
    }

    if (!isAgentConversationEligibleForTitleUpdate(latestConversation)) {
      if (latestConversation) {
        markTitleGenerated();
      }
      return;
    }

    if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length <= 50) {
      setConversationState((prev) =>
        updateAgentConversationById(prev, conversationId, (conv) => ({
          ...conv,
          title: cleanTitle,
          titleGenerated: true,
        }))
      );
    } else {
      markTitleGenerated();
    }
  } catch (titleErr) {
    console.warn('生成会话标题失败:', titleErr);
    markTitleGenerated();
  }
}
