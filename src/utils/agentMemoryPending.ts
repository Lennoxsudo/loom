/**
 * Agent Memory pending writes (write-approval staging).
 * Stored at ~/.loom/agent-memory/pending.json
 */

import { invoke } from '@tauri-apps/api/core';
import {
  AGENT_MEMORY_DIR_NAME,
  type AgentMemoryAction,
  type AgentMemoryTarget,
  getAgentMemoryDir,
} from './agentMemory';

export interface AgentMemoryPendingItem {
  id: string;
  action: AgentMemoryAction;
  target: AgentMemoryTarget;
  content?: string;
  oldText?: string;
  createdAt: number;
  conversationId?: string;
  reason?: string;
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const trimmedBase = base.replace(/[\\/]+$/, '');
  return [trimmedBase, ...parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ''))].join(sep);
}

async function pendingFilePath(): Promise<string> {
  const dir = await getAgentMemoryDir();
  if (!dir) return '';
  return joinPath(dir, 'pending.json');
}

function normalizePendingItem(raw: Partial<AgentMemoryPendingItem>): AgentMemoryPendingItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const target = raw.target;
  if (target !== 'user' && target !== 'memory') return null;
  const action = raw.action === 'replace' || raw.action === 'remove' ? raw.action : 'add';
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  const oldText = typeof raw.oldText === 'string' ? raw.oldText.trim() : '';
  if (action === 'add' && !content) return null;
  if (action === 'replace' && (!content || !oldText)) return null;
  if (action === 'remove' && !oldText) return null;

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id
        : `pending_${Date.now().toString(36)}`,
    action,
    target,
    content: content || undefined,
    oldText: oldText || undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    conversationId: raw.conversationId,
    reason: raw.reason,
  };
}

export async function loadAgentMemoryPending(): Promise<AgentMemoryPendingItem[]> {
  const filePath = await pendingFilePath();
  if (!filePath) return [];
  try {
    const raw = (await invoke<string>('read_file_content', { filePath })) ?? '';
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as { items?: unknown[] };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .map((item) => normalizePendingItem(item as Partial<AgentMemoryPendingItem>))
      .filter((item): item is AgentMemoryPendingItem => !!item);
  } catch {
    return [];
  }
}

async function savePending(items: AgentMemoryPendingItem[]): Promise<void> {
  const dir = await getAgentMemoryDir();
  if (!dir) throw new Error('Unable to resolve agent-memory directory');
  try {
    await invoke('create_folder', { folderPath: dir });
  } catch {
    // may exist
  }
  await invoke('write_file_content', {
    filePath: joinPath(dir, 'pending.json'),
    content: `${JSON.stringify({ items }, null, 2)}\n`,
  });
}

export async function stageAgentMemoryPending(
  item: Omit<AgentMemoryPendingItem, 'id' | 'createdAt' | 'action'> & {
    id?: string;
    createdAt?: number;
    action?: AgentMemoryAction;
  }
): Promise<AgentMemoryPendingItem> {
  const items = await loadAgentMemoryPending();
  const next = normalizePendingItem({
    id: item.id ?? `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    action: item.action ?? 'add',
    target: item.target,
    content: item.content,
    oldText: item.oldText,
    createdAt: item.createdAt ?? Date.now(),
    conversationId: item.conversationId,
    reason: item.reason,
  });
  if (!next) throw new Error('invalid pending item');

  const dup = items.some(
    (i) =>
      i.action === next.action &&
      i.target === next.target &&
      (i.content ?? '') === (next.content ?? '') &&
      (i.oldText ?? '') === (next.oldText ?? '')
  );
  if (dup) return next;

  items.push(next);
  await savePending(items);
  return next;
}

export async function removeAgentMemoryPending(id: string): Promise<boolean> {
  const items = await loadAgentMemoryPending();
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  await savePending(next);
  return true;
}

export async function clearAgentMemoryPending(): Promise<void> {
  await savePending([]);
}

/** Exported for tests that need the dir name constant nearby. */
export const AGENT_MEMORY_PENDING_DIR = AGENT_MEMORY_DIR_NAME;
