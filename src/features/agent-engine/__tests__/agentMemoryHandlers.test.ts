import { describe, expect, it, vi, beforeEach } from 'vitest';

const settingsState = {
  enableAgentMemory: true,
  enableAgentMemoryUserProfile: true,
  enableAgentMemoryNotes: true,
  agentMemoryWriteApproval: false,
};

vi.mock('../../../utils/agentMemory', () => ({
  mutateAgentMemoryStore: vi.fn(),
  loadAgentMemoryEntries: vi.fn(async () => []),
  applyAgentMemoryMutation: vi.fn((_entries, _action, options) => ({
    ok: true,
    entries: options.content ? [options.content] : [],
    usage: '1/2200',
    message: 'Added entry.',
  })),
  charLimitForTarget: vi.fn((target: string) => (target === 'user' ? 1375 : 2200)),
  formatLiveEntriesSummary: vi.fn(() => 'Live entries'),
}));

vi.mock('../../../utils/agentMemoryPending', () => ({
  stageAgentMemoryPending: vi.fn(),
}));

vi.mock('../../../stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

import { mutateAgentMemoryStore } from '../../../utils/agentMemory';
import { stageAgentMemoryPending } from '../../../utils/agentMemoryPending';
import { getToolHandler } from '../registry';
import '../handlers/agentMemoryHandlers';

describe('agentMemoryHandlers', () => {
  beforeEach(() => {
    settingsState.agentMemoryWriteApproval = false;
    vi.mocked(mutateAgentMemoryStore).mockReset();
    vi.mocked(stageAgentMemoryPending).mockReset();
  });

  it('adds an entry', async () => {
    vi.mocked(mutateAgentMemoryStore).mockResolvedValue({
      ok: true,
      entries: ['prefers concise'],
      usage: '16/1375',
      message: 'Added entry.',
      liveSummary: 'Live user entries (1)',
    });
    const handler = getToolHandler('agent_memory');
    expect(handler).toBeTruthy();
    const result = await handler!.execute(
      { action: 'add', target: 'user', content: 'prefers concise' },
      undefined
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Added entry');
    expect(mutateAgentMemoryStore).toHaveBeenCalled();
  });

  it('stages instead of writing when write approval is on', async () => {
    settingsState.agentMemoryWriteApproval = true;
    vi.mocked(stageAgentMemoryPending).mockResolvedValue({
      id: 'p1',
      action: 'add',
      target: 'memory',
      content: '阶段3待确认-abc',
      createdAt: Date.now(),
      reason: 'tool',
    });
    const handler = getToolHandler('agent_memory');
    const result = await handler!.execute(
      { action: 'add', target: 'memory', content: '阶段3待确认-abc' },
      undefined
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toMatch(/Staged for approval/i);
    expect(stageAgentMemoryPending).toHaveBeenCalled();
    expect(mutateAgentMemoryStore).not.toHaveBeenCalled();
  });

  it('returns error payload when mutation fails', async () => {
    vi.mocked(mutateAgentMemoryStore).mockResolvedValue({
      ok: false,
      entries: [],
      usage: '0/2200',
      error: 'Agent Memory is disabled in settings',
      liveSummary: '',
    });
    const handler = getToolHandler('agent_memory');
    const result = await handler!.execute(
      { action: 'add', target: 'memory', content: 'x' },
      undefined
    );
    expect(result.error).toMatch(/disabled/i);
  });

  it('remove accepts content as old_text substring', async () => {
    vi.mocked(mutateAgentMemoryStore).mockResolvedValue({
      ok: true,
      entries: [],
      usage: '0/2200',
      message: 'Removed entry.',
      liveSummary: 'Live memory entries (0)',
    });
    const handler = getToolHandler('agent_memory');
    const result = await handler!.execute(
      { action: 'remove', target: 'memory', content: 'prefers dark' },
      undefined
    );
    expect(result.error).toBeUndefined();
    expect(mutateAgentMemoryStore).toHaveBeenCalledWith(
      'memory',
      'remove',
      expect.objectContaining({ oldText: 'prefers dark' })
    );
  });

  it('remove without needle lists current entries', async () => {
    const { loadAgentMemoryEntries } = await import('../../../utils/agentMemory');
    vi.mocked(loadAgentMemoryEntries).mockResolvedValueOnce(['keep me', 'delete me']);
    const handler = getToolHandler('agent_memory');
    const result = await handler!.execute({ action: 'remove', target: 'memory' }, undefined);
    expect(result.error).toMatch(/old_text/i);
    expect(result.error).toContain('keep me');
    expect(mutateAgentMemoryStore).not.toHaveBeenCalled();
  });
});
