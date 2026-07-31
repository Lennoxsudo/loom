import {
  mutateAgentMemoryStore,
  type AgentMemoryFlags,
} from './agentMemory';
import {
  loadAgentMemoryPending,
  removeAgentMemoryPending,
  type AgentMemoryPendingItem,
} from './agentMemoryPending';
import { useSettingsStore } from '../stores/useSettingsStore';

export async function approveAgentMemoryPending(
  id: string
): Promise<{ ok: boolean; error?: string; item?: AgentMemoryPendingItem }> {
  const items = await loadAgentMemoryPending();
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, error: 'Pending item not found' };

  const s = useSettingsStore.getState();
  const flags: AgentMemoryFlags = {
    enableAgentMemory: s.enableAgentMemory,
    enableAgentMemoryUserProfile: s.enableAgentMemoryUserProfile,
    enableAgentMemoryNotes: s.enableAgentMemoryNotes,
  };

  const result = await mutateAgentMemoryStore(item.target, item.action, {
    content: item.content,
    oldText: item.oldText,
    flags,
  });
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Failed to write memory', item };
  }

  await removeAgentMemoryPending(id);
  return { ok: true, item };
}

export async function rejectAgentMemoryPending(id: string): Promise<boolean> {
  return removeAgentMemoryPending(id);
}
