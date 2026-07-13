import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolHandler, hasToolHandler } from '../registry';
import { RunSubagentHandler } from '../handlers/subagentHandlers';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { SUBAGENT_DISABLED_SUMMARY } from '../../../utils/subagents/bootstrap';
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

describe('RunSubagentHandler Registry', () => {
  it('should register run_subagent handler', () => {
    expect(hasToolHandler('run_subagent')).toBe(true);
    const handler = getToolHandler('run_subagent');
    expect(handler).toBeInstanceOf(RunSubagentHandler);
  });
});

describe('RunSubagentHandler Execution', () => {
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
    useSettingsStore.setState({ enableSubagents: true });
    useSubagentStore.setState({ runs: {} });
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });
  });

  it('should fail if task is missing or empty', async () => {
    const result = await handler.execute({ task: '' });
    expect(result.error).toContain('缺少必需参数');
  });

  it('returns disabled summary when enableSubagents is false', async () => {
    useSettingsStore.setState({ enableSubagents: false });

    const result = await handler.execute(
      { task: 'Do some work' },
      { agentId: 'parent-agent-id' }
    );

    expect(result.output).toBe(SUBAGENT_DISABLED_SUMMARY);
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(Object.keys(useSubagentStore.getState().runs)).toHaveLength(0);
  });

  it('should filter allowed tools and exclude run_subagent', async () => {
    runAgentLoopMock.mockResolvedValue({ finalText: 'Task accomplished.', steps: 3 });

    const result = await handler.execute(
      {
        task: 'Do some work',
        preset: 'research',
        allowed_tools: ['read', 'write', 'run_subagent'],
        model: 'inherit',
      },
      { agentId: 'parent-agent-id' }
    );

    // Verify task registration in store
    const runs = useSubagentStore.getState().runs;
    const taskIds = Object.keys(runs);
    expect(taskIds.length).toBe(1);
    
    const run = runs[taskIds[0]];
    expect(run.task.description).toBe('Do some work');
    expect(run.task.allowedTools).toEqual(['read', 'write']); // run_subagent must be filtered out
    expect(run.status).toBe('succeeded');
    expect(run.result?.summary).toBe('Task accomplished.');
    expect(result.output).toBe('Task accomplished.');
  });

  it('should handle loop failure gracefully', async () => {
    runAgentLoopMock.mockRejectedValue(new Error('API failure'));

    const result = await handler.execute(
      { task: 'Do some work' },
      { agentId: 'parent-agent-id' }
    );

    const runs = useSubagentStore.getState().runs;
    const taskIds = Object.keys(runs);
    expect(taskIds.length).toBe(1);
    
    const run = runs[taskIds[0]];
    expect(run.status).toBe('failed');
    expect(run.result?.error).toBe('API failure');
    expect(result.output).toContain('子代理运行失败');
    expect(result.error).toBe('API failure');
  });
});

describe('useSubagentStore visualization actions', () => {
  beforeEach(() => {
    useSubagentStore.setState({ runs: {} });
  });

  it('should support incremental visual updates', () => {
    const taskId = 'test-task-123';
    const task = {
      id: taskId,
      description: 'Test visual updates',
    };

    const store = useSubagentStore.getState();
    store.startSubagent(task);

    // Verify initial values
    let run = useSubagentStore.getState().runs[taskId];
    expect(run.status).toBe('pending');
    expect(run.streamingText).toBe('');
    expect(run.thinkingText).toBe('');
    expect(run.toolEvents).toEqual([]);

    // 1. Append streaming chunks
    useSubagentStore.getState().appendStreamChunk(taskId, 'Hello ');
    useSubagentStore.getState().appendStreamChunk(taskId, 'world!');
    run = useSubagentStore.getState().runs[taskId];
    expect(run.streamingText).toBe('Hello world!');

    // 2. Append thinking chunks
    useSubagentStore.getState().appendThinking(taskId, 'Thinking chunk 1. ');
    useSubagentStore.getState().appendThinking(taskId, 'Thinking chunk 2.');
    run = useSubagentStore.getState().runs[taskId];
    expect(run.thinkingText).toBe('Thinking chunk 1. Thinking chunk 2.');

    // 3. Push tool events
    const toolCallId1 = 'tool-1';
    useSubagentStore.getState().pushToolEvent(taskId, {
      id: toolCallId1,
      toolName: 'read',
      status: 'running',
    });
    run = useSubagentStore.getState().runs[taskId];
    expect(run.toolEvents?.length).toBe(1);
    expect(run.toolEvents?.[0]).toMatchObject({
      id: toolCallId1,
      toolName: 'read',
      status: 'running',
    });
    expect(run.toolEvents?.[0].at).toBeGreaterThan(0);

    // 4. Update tool event status and outcome preview
    useSubagentStore.getState().updateToolEvent(taskId, toolCallId1, {
      status: 'done',
      resultPreview: 'file contents preview',
    });
    run = useSubagentStore.getState().runs[taskId];
    expect(run.toolEvents?.[0]).toMatchObject({
      id: toolCallId1,
      toolName: 'read',
      status: 'done',
      resultPreview: 'file contents preview',
    });
  });
});

