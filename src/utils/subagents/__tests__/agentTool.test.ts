import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolHandler, hasToolHandler } from '../../aiTools/registry';
import { AgentToolHandler } from '../../aiTools/handlers/agentToolHandler';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const spawnSubagentMock = vi.fn();
vi.mock('../spawn', () => ({
  spawnSubagent: (...args: unknown[]) => spawnSubagentMock(...args),
}));

describe('Agent tool handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agents') return [];
      return null;
    });
    spawnSubagentMock.mockResolvedValue({
      taskId: 't1',
      status: 'succeeded',
      summary: 'done',
    });
  });

  it('registers Agent and Task handlers', () => {
    expect(hasToolHandler('Agent')).toBe(true);
    expect(hasToolHandler('Task')).toBe(true);
    expect(getToolHandler('Agent')).toBeInstanceOf(AgentToolHandler);
  });

  it('delegates to spawnSubagent with subagent_type', async () => {
    const handler = getToolHandler('Agent') as AgentToolHandler;
    await handler.execute(
      { prompt: 'Explore the repo', subagent_type: 'Explore' },
      { toolCallId: 'tc-1', parentProvider: 'openai', parentModel: 'gpt-4o' }
    );

    expect(spawnSubagentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Explore the repo',
        subagentType: 'Explore',
        taskId: 'tc-1',
      })
    );
  });
});
