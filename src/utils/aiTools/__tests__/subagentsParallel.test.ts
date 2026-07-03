import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getToolHandler, hasToolHandler } from '../registry';
import { RunSubagentsHandler } from '../handlers/subagentHandlers';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';
import { executeToolCall } from '../toolExecutor';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock runAgentLoop
const runAgentLoopMock = vi.fn();
vi.mock('../../runAgentLoop', () => ({
  runAgentLoop: (...args: any[]) => runAgentLoopMock(...args),
}));

describe('RunSubagentsHandler Registry', () => {
  it('should register run_subagents handler', () => {
    expect(hasToolHandler('run_subagents')).toBe(true);
    const handler = getToolHandler('run_subagents');
    expect(handler).toBeInstanceOf(RunSubagentsHandler);
  });
});

describe('RunSubagentsHandler Execution', () => {
  let handler: RunSubagentsHandler;

  beforeEach(() => {
    handler = new RunSubagentsHandler();
    vi.clearAllMocks();
    useSubagentStore.setState({ runs: {} });
    useSettingsStore.setState({ enableSubagents: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fail if tasks list is missing or empty', async () => {
    const result = await handler.execute({ tasks: [] });
    expect(result.error).toContain('缺少必需参数');
  });

  it('should start all parallel tasks without a concurrency cap', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' }
    ];
    vi.mocked(invoke).mockResolvedValue(mockAgents);

    const startOrder: number[] = [];
    let activeCount = 0;
    let peakActiveCount = 0;

    runAgentLoopMock.mockImplementation(async () => {
      const taskIndex = runAgentLoopMock.mock.calls.length - 1;
      startOrder.push(taskIndex);
      activeCount++;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeCount--;
      return { finalText: `Done ${taskIndex}`, steps: 1 };
    });

    const tasks = [
      { task: 'Task 1' },
      { task: 'Task 2' },
      { task: 'Task 3' },
      { task: 'Task 4' },
    ];

    await handler.execute(
      { tasks },
      { agentId: 'parent-id', toolCallId: 'test-parent-call-id' }
    );

    expect(startOrder.length).toBe(4);
    expect(peakActiveCount).toBe(4);
    expect(activeCount).toBe(0);
  });

  it('should aggregate successes and failures and not fail the entire batch', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' }
    ];
    vi.mocked(invoke).mockResolvedValue(mockAgents);

    // Task 1 succeeds, Task 2 fails
    runAgentLoopMock
      .mockResolvedValueOnce({ finalText: 'Task 1 Done', steps: 2 })
      .mockRejectedValueOnce(new Error('Network Timeout'));

    const tasks = [
      { task: 'Perform compile' },
      { task: 'Run lint check' }
    ];

    const result = await handler.execute(
      { tasks },
      { agentId: 'parent-id', toolCallId: 'test-parent-call-id' }
    );

    expect(result.output).toContain('并行子代理结果（共 2 个，成功 1 / 失败 1 / 取消 0）');
    expect(result.output).toContain('【子代理 1 · 成功】Perform compile');
    expect(result.output).toContain('Task 1 Done');
    expect(result.output).toContain('【子代理 2 · 失败】Run lint check');
    expect(result.output).toContain('Network Timeout');

    // Check store states
    const runs = useSubagentStore.getState().runs;
    const runKeys = Object.keys(runs);
    expect(runKeys.length).toBe(2);

    const task1 = runs[runKeys.find((k) => k.includes('-0-'))!];
    const task2 = runs[runKeys.find((k) => k.includes('-1-'))!];

    expect(task1.status).toBe('succeeded');
    expect(task1.result?.summary).toBe('Task 1 Done');
    
    expect(task2.status).toBe('failed');
    expect(task2.result?.error).toBe('Network Timeout');
  });

  it('should exclude run_subagent and run_subagents from subagents capabilities', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agents') return [{ id: 'parent-id', provider: 'openai', model: 'gpt-4o' }];
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });
    runAgentLoopMock.mockResolvedValue({ finalText: 'Done', steps: 1 });

    const tasks = [
      { task: 'Subtask', preset: 'research', allowed_tools: ['read', 'write', 'run_subagent', 'run_subagents'] }
    ];

    await handler.execute(
      { tasks },
      { agentId: 'parent-id', toolCallId: 'test-parent-call-id' }
    );

    const callArgs = runAgentLoopMock.mock.calls[0][0];
    expect(callArgs.tools.some((t: any) => t.name === 'run_subagent')).toBe(false);
    expect(callArgs.tools.some((t: any) => t.name === 'run_subagents')).toBe(false);
  });

  it('should verify context.toolCallId is passed inside executeToolCall', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' }
    ];
    vi.mocked(invoke).mockResolvedValue(mockAgents);
    runAgentLoopMock.mockResolvedValue({ finalText: 'Done', steps: 1 });

    const toolCall = {
      id: 'tool-call-12345',
      type: 'function' as const,
      function: {
        name: 'run_subagent',
        arguments: JSON.stringify({ task: 'Verify toolCallId propagation' }),
      },
    };

    const result = await executeToolCall(toolCall, { agentId: 'parent-id' });
    expect(result.tool_call_id).toBe('tool-call-12345');

    // Inspect the runs store to verify taskId is set to the toolCall.id
    const runs = useSubagentStore.getState().runs;
    expect(runs['tool-call-12345']).toBeDefined();
    expect(runs['tool-call-12345'].task.id).toBe('tool-call-12345');
  });

  it('should run run_subagents end-to-end via executeToolCall successfully', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' }
    ];
    vi.mocked(invoke).mockResolvedValue(mockAgents);
    runAgentLoopMock.mockResolvedValue({ finalText: 'Task accomplished successfully', steps: 1 });

    const toolCall = {
      id: 'tool-call-99999',
      type: 'function' as const,
      function: {
        name: 'run_subagents',
        arguments: JSON.stringify({
          tasks: [
            { task: 'Subtask A' },
            { task: 'Subtask B' }
          ]
        }),
      },
    };

    const result = await executeToolCall(toolCall, { agentId: 'parent-id' });
    
    expect(result.tool_call_id).toBe('tool-call-99999');
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('并行子代理结果（共 2 个，成功 2 / 失败 0 / 取消 0）');
    expect(result.output).toContain('【子代理 1 · 成功】Subtask A');
    expect(result.output).toContain('【子代理 2 · 成功】Subtask B');
  });
});
