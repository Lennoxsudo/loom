import { useEffect } from 'react';
import type { AgentConversationState } from '../../../types/chat';
import { hydrateSubagentRunsFromConversationState } from '../../../utils/subagents/persistSubagentRuns';

/** Rehydrate subagent card state from persisted message snapshots when conversations load or switch. */
export function useHydrateSubagentRuns(conversationState: AgentConversationState) {
  useEffect(() => {
    hydrateSubagentRunsFromConversationState(conversationState.conversations ?? []);
  }, [conversationState.conversations]);
}
