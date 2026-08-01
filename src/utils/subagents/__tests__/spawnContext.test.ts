import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import { spawnSubagent } from '../spawn';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('../../agentPersistence', async () => {
  const actual = await vi.importActual<typeof import('../../agentPersistence')>(
    '../../agentPersistence'
  );
  return {
    ...actual,
    getAgent: vi.fn(async () => ({
      id: 'agent-1',
      name: 'Helper',
      rules: 'Always cite file paths.',
    })),
  };
});

vi.mock('../contextPolicy', async () => {
  const actual = await vi.importActual<typeof import('../contextPolicy')>('../contextPolicy');
  return {
    ...actual,
    loadClaudeMd: vi.fn(async () => ''),
  };
});

const runAgentLoopMock = vi.fn();
vi.mock('../../runAgentLoop', () => ({
  runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args),
  buildForkMessages: vi.fn(() => []),
  filterToolsForSubagentType: vi.fn((tools: unknown) => tools),
}));

describe('spawnSubagent context injection', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enableSubagents: true });
    useSubagentStore.setState({ runs: {} });
    vi.clearAllMocks();
    runAgentLoopMock.mockResolvedValue({ finalText: 'done', steps: 1 });
  });

  it('injects parent agent rules when injectRules policy is true', async () => {
    await spawnSubagent({
      taskId: 'task-rules',
      prompt: 'Inspect the repo',
      subagentType: 'general-purpose',
      parentProvider: 'openai',
      parentModel: 'gpt-4o',
      parentContext: {
        baseDir: 'D:\\project\\demo',
        agentMemoryFrozenText: '## Agent Memory (frozen for this session)\nprefer pnpm',
      },
    });

    expect(runAgentLoopMock).toHaveBeenCalled();
    const args = runAgentLoopMock.mock.calls[0]?.[0] as { systemPrompt?: string };
    expect(args.systemPrompt).toContain('[Rules Context]');
    expect(args.systemPrompt).toContain('Always cite file paths.');
    expect(args.systemPrompt).toContain('Agent Memory (frozen for this session)');
    expect(args.systemPrompt).toContain('prefer pnpm');
  });

  it('skips parent rules for Explore (skipRules)', async () => {
    await spawnSubagent({
      taskId: 'task-explore',
      prompt: 'Search code',
      subagentType: 'Explore',
      parentProvider: 'openai',
      parentModel: 'gpt-4o',
      parentContext: {
        baseDir: 'D:\\project\\demo',
        agentMemoryFrozenText: '## Agent Memory\nkeep me',
      },
    });

    const args = runAgentLoopMock.mock.calls[0]?.[0] as { systemPrompt?: string };
    expect(args.systemPrompt).not.toContain('[Rules Context]');
    expect(args.systemPrompt).toContain('Agent Memory');
  });
});
