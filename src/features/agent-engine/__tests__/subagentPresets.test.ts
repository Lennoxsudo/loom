import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunSubagentHandler } from '../handlers/subagentHandlers';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock runAgentLoop
const runAgentLoopMock = vi.fn();
vi.mock('../../../utils/runAgentLoop', () => ({
  runAgentLoop: (...args: any[]) => runAgentLoopMock(...args),
  buildForkMessages: (messages: any) => messages ?? [],
  filterToolsForSubagentType: <T,>(tools: T[]) => tools,
}));

describe('RunSubagentHandler - Presets, Budget, Rounds, and Models', () => {
  let handler: RunSubagentHandler;
  const mockAgents = [
    {
      id: 'parent-agent-id',
      name: 'Parent Agent',
      model: 'openai:gpt-4o',
      provider: 'openai',
      capabilities: {
        canExecuteCommands: true,
        canAccessBrowser: true,
        canUseGit: true,
        canUseMcp: true,
      },
      temperature: 0.7,
      createdAt: '',
      updatedAt: '',
    },
  ];

  beforeEach(() => {
    handler = new RunSubagentHandler();
    vi.clearAllMocks();
    useSubagentStore.setState({ runs: {} });
    useSettingsStore.setState({
      enableSubagents: true,
    });
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });
  });

  // 1. Presets Allowed Tools
  it('should use read-only tools for research preset', async () => {
    runAgentLoopMock.mockResolvedValue({ finalText: 'Research result.', steps: 1 });

    await handler.execute(
      {
        task: 'Study this codebase',
        preset: 'research',
      },
      { agentId: 'parent-agent-id' }
    );

    const runs = useSubagentStore.getState().runs;
    const run = Object.values(runs)[0];
    expect(run.task.allowedTools).toEqual([
      'read',
      'search',
      'finfo',
      'sym',
      'fetch',
      'graph_query',
      'graph_trace',
    ]);
  });

  it('should let explicit allowed_tools override preset tools', async () => {
    runAgentLoopMock.mockResolvedValue({ finalText: 'Done.', steps: 1 });

    await handler.execute(
      {
        task: 'Study this codebase',
        preset: 'research',
        allowed_tools: ['read', 'write'],
      },
      { agentId: 'parent-agent-id' }
    );

    const runs = useSubagentStore.getState().runs;
    const run = Object.values(runs)[0];
    expect(run.task.allowedTools).toEqual(['read', 'write']);
  });

  // 2. Context Token Budgeting
  it('should truncate context when AI sets context_budget', async () => {
    runAgentLoopMock.mockResolvedValue({ finalText: 'Done.', steps: 1 });

    const longContext = 'A'.repeat(50000);

    await handler.execute(
      {
        task: 'Process data',
        context: longContext,
        context_budget: 4000,
      },
      { agentId: 'parent-agent-id' }
    );

    expect(runAgentLoopMock).toHaveBeenCalled();
    const options = runAgentLoopMock.mock.calls[0][0];
    expect(options.systemPrompt).toContain('[WARNING: 上下文已按预算截断 / Context truncated by budget]');
    expect(options.initialUserMessage).toContain('[WARNING: 上下文已按预算截断 / Context truncated by budget]');
    expect(options.initialUserMessage).toContain('... [上下文已按预算截断 / Context truncated by budget]');
  });

  // 3. Max Rounds Truncation
  it('should fail and output truncation message when runAgentLoop exits due to max rounds', async () => {
    runAgentLoopMock.mockResolvedValue({ finalText: 'Incomplete response', steps: 10, truncated: true });

    const result = await handler.execute(
      {
        task: 'Infinite loop task',
      },
      { agentId: 'parent-agent-id' }
    );

    expect(result.error).toBe('Reached maximum tool call rounds');
    expect(result.output).toContain('因达到最大轮次被截断');
    
    const runs = useSubagentStore.getState().runs;
    const run = Object.values(runs)[0];
    expect(run.status).toBe('failed');
    expect(run.result?.truncated).toBe(true);
    expect(run.result?.summary).toContain('因达到最大轮次被截断');
  });

  // 4. Model Overrides & Fallbacks
  it('should use specified model when it is configured in AI profiles', async () => {
    // Mock load_ai_config returning a configured model
    const mockAIConfig = JSON.stringify({
      profiles: {
        openai: {
          items: [
            {
              id: 'my-profile',
              apiKey: 'sk-123',
              models: ['gpt-4-turbo'],
            },
          ],
        },
      },
    });

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_ai_config') return mockAIConfig;
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      return null;
    });

    runAgentLoopMock.mockResolvedValue({ finalText: 'Model matched.', steps: 1 });

    await handler.execute(
      {
        task: 'Use specific model',
        model: 'gpt-4-turbo',
      },
      { agentId: 'parent-agent-id' }
    );

    expect(runAgentLoopMock).toHaveBeenCalled();
    const options = runAgentLoopMock.mock.calls[0][0];
    expect(options.model).toBe('gpt-4-turbo');
    expect(options.provider).toBe('openai');
  });

  it('should fall back to parent model and add warning if model is not configured', async () => {
    // Mock empty profiles config
    const mockAIConfig = JSON.stringify({
      profiles: {
        openai: { items: [] },
      },
    });

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_ai_config') return mockAIConfig;
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      return null;
    });

    runAgentLoopMock.mockResolvedValue({ finalText: 'Fallback model used.', steps: 1 });

    const result = await handler.execute(
      {
        task: 'Use nonexistent model',
        model: 'nonexistent-model-123',
      },
      { agentId: 'parent-agent-id' }
    );

    expect(runAgentLoopMock).toHaveBeenCalled();
    const options = runAgentLoopMock.mock.calls[0][0];
    // Should fall back to parent agent's parsed model name (not composite id)
    expect(options.model).toBe('gpt-4o');
    
    // Result output should contain fallback warning
    expect(result.output).toContain('未在已配置的 AI 服务商中找到，已回退到主代理模型');
  });
});
