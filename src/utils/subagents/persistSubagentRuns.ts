import type { ChatMessage } from '../../types/chat';
import { toPersistedSubagentRun, type PersistedSubagentRun } from '../../types/subagent';
import { useSubagentStore } from '../../stores/useSubagentStore';

const SUBAGENT_SNAPSHOT_TOOL_NAMES = new Set(['run_subagent', 'run_subagents', 'Agent', 'Task']);

export function isSubagentSnapshotToolName(toolName: string | undefined): boolean {
  return !!toolName && SUBAGENT_SNAPSHOT_TOOL_NAMES.has(toolName);
}

export function collectSubagentRunsForToolCall(
  toolCallId: string,
  toolName: string
): PersistedSubagentRun[] {
  if (!isSubagentSnapshotToolName(toolName)) {
    return [];
  }

  const runs = useSubagentStore.getState().runs;

  if (toolName === 'run_subagents') {
    return Object.entries(runs)
      .filter(([id]) => id.startsWith(`${toolCallId}-`))
      .map(([, run]) => toPersistedSubagentRun(run));
  }

  const run = runs[toolCallId];
  return run ? [toPersistedSubagentRun(run)] : [];
}

export function collectPersistedSubagentRunsFromMessages(
  messages: ChatMessage[]
): PersistedSubagentRun[] {
  const records: PersistedSubagentRun[] = [];
  for (const message of messages) {
    if (message.subagentRuns?.length) {
      records.push(...message.subagentRuns);
    }
  }
  return records;
}

export function collectPersistedSubagentRunsFromConversationState(
  conversations: Array<{ messages?: ChatMessage[] }>
): PersistedSubagentRun[] {
  return conversations.flatMap((conversation) =>
    collectPersistedSubagentRunsFromMessages(conversation.messages ?? [])
  );
}

export function attachSubagentRunsSnapshot(
  message: ChatMessage,
  toolCallId: string,
  toolName: string
): ChatMessage {
  const subagentRuns = collectSubagentRunsForToolCall(toolCallId, toolName);
  if (subagentRuns.length === 0) {
    return message;
  }
  return { ...message, subagentRuns };
}

export function hydrateSubagentRunsFromConversationState(
  conversations: Array<{ messages?: ChatMessage[] }>
): void {
  const records = collectPersistedSubagentRunsFromConversationState(conversations);
  useSubagentStore.getState().hydrateRuns(records);
}
