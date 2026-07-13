import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunSubagentsHandler } from '../handlers/subagentHandlers';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock runAgentLoop with controllable implementations
const runAgentLoopMock = vi.fn();
vi.mock('../../../utils/runAgentLoop', () => ({
  runAgentLoop: (...args: any[]) => runAgentLoopMock(...args),
  buildForkMessages: (messages: any) => messages ?? [],
  filterToolsForSubagentType: <T,>(tools: T[]) => tools,
}));

describe('Subagent E2E Smoke Tests', () => {
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

  it('should run two parallel subagents to completion with metrics', async () => {
    // Setup: mock agent config
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' },
    ];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });

    // Each subagent runs one read-only tool step and succeeds
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      // Simulate a brief delay
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Fire tool-start/tool-end events via onEvent to simulate a read tool call
      if (opts.onEvent) {
        opts.onEvent({
          type: 'tool-start',
          messageId: 'sub-msg',
          toolName: 'read',
          toolCallId: `tool-${Math.random().toString(36).substring(2, 6)}`,
        });
        opts.onEvent({
          type: 'tool-end',
          messageId: 'sub-msg',
          toolName: 'read',
          toolCallId: `tool-${Math.random().toString(36).substring(2, 6)}`,
          toolResult: { tool_call_id: '', output: 'file contents here' },
        });
      }
      return {
        finalText: `Summary for ${opts.initialUserMessage.substring(0, 20)}`,
        steps: 1,
        truncated: false,
        promptTokens: 150,
        completionTokens: 50,
      };
    });

    const tasks = [
      { task: 'Research topic A' },
      { task: 'Research topic B' },
    ];

    const result = await handler.execute(
      { tasks },
      { agentId: 'parent-id', toolCallId: 'e2e-parent-call' }
    );

    // 1. Aggregate output contains "成功 2"
    expect(result.output).toContain('成功 2');
    expect(result.output).toContain('【子代理 1 · 成功】');
    expect(result.output).toContain('【子代理 2 · 成功】');

    // 2. Both summaries present
    expect(result.output).toContain('Summary for');

    // 3. Check store runs have metrics
    const runs = useSubagentStore.getState().runs;
    const runKeys = Object.keys(runs);
    expect(runKeys.length).toBe(2);

    for (const key of runKeys) {
      const run = runs[key];
      expect(run.status).toBe('succeeded');
      expect(run.result).toBeDefined();
      expect(run.result!.metrics).toBeDefined();

      const m = run.result!.metrics!;
      expect(m.durationMs).toBeGreaterThanOrEqual(0);
      expect(m.steps).toBe(1);
      expect(m.totalTokens).toBeGreaterThan(0);
      expect(m.promptTokens).toBe(150);
      expect(m.completionTokens).toBe(50);
      expect(m.totalTokens).toBe(m.promptTokens + m.completionTokens);
    }

    // 4. finishedAt is set
    for (const key of runKeys) {
      expect(runs[key].finishedAt).toBeDefined();
      expect(runs[key].finishedAt).toBeGreaterThanOrEqual(runs[key].startedAt || 0);
    }
  });

  it('should write partial metrics on cancellation', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' },
    ];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });

    // One subagent gets cancelled via abort, the other succeeds
    runAgentLoopMock
      .mockImplementationOnce(async (opts: any) => {
        // Simulate partial streaming then abort
        if (opts.onEvent) {
          opts.onEvent({ type: 'chunk', messageId: 'sub-msg', chunk: 'partial output', chunkType: 'content' });
        }
        // Wait a bit then simulate abort
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error('Subagent loop aborted by user');
      })
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          finalText: 'Task 2 done',
          steps: 1,
          truncated: false,
          promptTokens: 100,
          completionTokens: 30,
        };
      });

    const tasks = [
      { task: 'Long running task' },
      { task: 'Quick task' },
    ];

    const result = await handler.execute(
      { tasks },
      { agentId: 'parent-id', toolCallId: 'e2e-cancel-test' }
    );

    // Output should contain one cancelled and one succeeded
    expect(result.output).toContain('已取消');
    expect(result.output).toContain('成功');

    const runs = useSubagentStore.getState().runs;
    const runKeys = Object.keys(runs);

    // Find the cancelled run
    const cancelledRun = runKeys.find((k) => runs[k].status === 'cancelled');
    expect(cancelledRun).toBeDefined();
    if (cancelledRun) {
      const cancelledResult = runs[cancelledRun].result!;
      expect(cancelledResult.metrics).toBeDefined();
      expect(cancelledResult.metrics!.durationMs).toBeGreaterThanOrEqual(0);
      // Partial metrics should have at least prompt tokens from system prompt + initial message
      expect(cancelledResult.metrics!.totalTokens).toBeGreaterThan(0);
    }
  });

  it('should write metrics on failure (error in loop)', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' },
    ];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });

    runAgentLoopMock.mockRejectedValue(new Error('Network timeout'));

    const tasks = [{ task: 'Failing task' }];

    await handler.execute(
      { tasks },
      { agentId: 'parent-id', toolCallId: 'e2e-fail-test' }
    );

    const runs = useSubagentStore.getState().runs;
    const runKeys = Object.keys(runs);
    expect(runKeys.length).toBe(1);

    const failedRun = runs[runKeys[0]];
    expect(failedRun.status).toBe('failed');
    expect(failedRun.result).toBeDefined();
    expect(failedRun.result!.metrics).toBeDefined();
    expect(failedRun.result!.metrics!.durationMs).toBeGreaterThanOrEqual(0);
    // Even on failure, partial metrics should have some tokens
    expect(failedRun.result!.metrics!.totalTokens).toBeGreaterThan(0);
  });

  it('should clear pendingApproval after approval and write metrics', async () => {
    const mockAgents = [
      { id: 'parent-id', provider: 'openai', model: 'gpt-4o' },
    ];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      return null;
    });
    useSettingsStore.setState({ agentAccessMode: 'auto' });

    // Simulate: subagent runs, hits a non-read-only tool, gets approval, then succeeds
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      // Simulate tool-start for a write tool
      const toolCallId = 'write-tool-1';
      if (opts.onEvent) {
        opts.onEvent({ type: 'tool-start', messageId: 'sub-msg', toolName: 'write', toolCallId });
      }

      // If there's an onRequestToolApproval callback, simulate approval
      if (opts.context?.onRequestToolApproval) {
        const approvalResult = await opts.context.onRequestToolApproval({
          taskId: opts.taskId,
          toolName: 'write',
          detailPreview: '/tmp/test.txt',
        });
        // After approval, pendingApproval should be cleared
        expect(approvalResult).toBe('approve');
      }

      if (opts.onEvent) {
        opts.onEvent({
          type: 'tool-end',
          messageId: 'sub-msg',
          toolName: 'write',
          toolCallId,
          toolResult: { tool_call_id: toolCallId, output: 'File written' },
        });
      }

      return {
        finalText: 'File created successfully',
        steps: 1,
        truncated: false,
        promptTokens: 200,
        completionTokens: 80,
      };
    });

    // Create approval resolver that auto-approves
    const approvalPromise = new Promise<'approve' | 'reject'>((resolve) => {
      setTimeout(() => resolve('approve'), 10);
    });

    const onRequestToolApproval = vi.fn().mockReturnValue(approvalPromise);

    const tasks = [{ task: 'Create a file', allowed_tools: ['write', 'read'] }];

    const result = await handler.execute(
      { tasks },
      {
        agentId: 'parent-id',
        toolCallId: 'e2e-approval-test',
        onRequestToolApproval,
      }
    );

    // Subagent should succeed
    expect(result.output).toContain('成功 1');

    const runs = useSubagentStore.getState().runs;
    const runKeys = Object.keys(runs);
    expect(runKeys.length).toBe(1);

    const run = runs[runKeys[0]];
    expect(run.status).toBe('succeeded');
    // pendingApproval should be cleared
    expect(run.pendingApproval).toBeUndefined();
    // Metrics should be written
    expect(run.result?.metrics).toBeDefined();
    expect(run.result!.metrics!.totalTokens).toBe(280);
  });
});
