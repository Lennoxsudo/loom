import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_SESSION_EXTRAS_STORAGE_KEY,
  PENDING_CHANGES_STORAGE_KEY,
} from '../types/chat';
import type { PendingFileChange } from '../components/agent/utils';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

import {
  createDebouncedSessionExtrasSaver,
  loadAgentSessionExtras,
  readInitialSessionExtras,
  writeLocalSessionExtras,
  type AgentSessionExtras,
} from './agentSessionPersistence';

const pendingChange: PendingFileChange = {
  id: 'pc-1',
  agentId: 'agent-1',
  conversationId: 'conv-1',
  filePath: 'src/demo.ts',
  beforeContent: 'const x = 1;',
  afterContent: 'const x = 2;',
  toolName: 'write_file',
  createdAt: 1,
  updatedAt: 1,
};

describe('agentSessionPersistence', () => {
  afterEach(() => {
    localStorage.removeItem(AGENT_SESSION_EXTRAS_STORAGE_KEY);
    localStorage.removeItem(PENDING_CHANGES_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('reads initial extras from local storage and legacy pending changes', () => {
    writeLocalSessionExtras({
      version: 1,
      drafts: { 'agent-1::conv-1': 'saved draft' },
      pendingChanges: {},
    });
    localStorage.setItem(
      PENDING_CHANGES_STORAGE_KEY,
      JSON.stringify({ 'agent-1::conv-1': [pendingChange] })
    );

    const extras = readInitialSessionExtras();
    expect(extras.drafts['agent-1::conv-1']).toBe('saved draft');
    expect(extras.pendingChanges['agent-1::conv-1']).toHaveLength(1);
  });

  it('merges legacy pending changes and local extras on load', async () => {
    writeLocalSessionExtras({
      version: 1,
      drafts: { 'agent-1::conv-1': 'saved draft' },
      pendingChanges: {},
    });
    localStorage.setItem(
      PENDING_CHANGES_STORAGE_KEY,
      JSON.stringify({ 'agent-1::conv-1': [pendingChange] })
    );

    const extras = await loadAgentSessionExtras();
    expect(extras.drafts['agent-1::conv-1']).toBe('saved draft');
    expect(extras.pendingChanges['agent-1::conv-1']).toHaveLength(1);
  });

  it('debounces save calls', async () => {
    vi.useFakeTimers();
    const saver = createDebouncedSessionExtrasSaver(200);
    const payload: AgentSessionExtras = {
      version: 1,
      drafts: { 'agent-1::conv-1': 'hello' },
      pendingChanges: {},
    };

    saver.schedule(payload);
    saver.schedule({ ...payload, drafts: { 'agent-1::conv-1': 'hello again' } });

    expect(localStorage.getItem(AGENT_SESSION_EXTRAS_STORAGE_KEY)).toBeNull();

    await vi.advanceTimersByTimeAsync(200);

    const raw = localStorage.getItem(AGENT_SESSION_EXTRAS_STORAGE_KEY);
    expect(raw).toContain('hello again');
    vi.useRealTimers();
  });
});
