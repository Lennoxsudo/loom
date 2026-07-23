import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { getToolHandler } from '../registry';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

const listeners = new Map<string, Set<(event: any) => void>>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName, callback) => {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Set());
    }
    listeners.get(eventName)!.add(callback);
    return () => {
      listeners.get(eventName)?.delete(callback);
    };
  }),
}));

const emitEvent = (eventName: string, payload: any) => {
  const callbacks = listeners.get(eventName);
  if (callbacks) {
    for (const cb of callbacks) {
      cb({ payload });
    }
  }
};

// Mock executeToolCall to avoid calling actual filesystem operations
vi.mock('../toolExecutor', () => ({
  executeToolCall: vi.fn(async (toolCall) => {
    return {
      tool_call_id: toolCall.id,
      output: 'Mock tool execution output',
    };
  }),
}));

describe('Subagent Controllability & Approval Tests', () => {
  let handler: any;
  let batchHandler: any;
  let parentContext: any;

  const returnedToolCalls = new Set<string>();

  beforeEach(() => {
    handler = getToolHandler('run_subagent');
    batchHandler = getToolHandler('run_subagents');
    vi.clearAllMocks();
    listeners.clear();
    returnedToolCalls.clear();
    useSubagentStore.setState({ runs: {} });
    useSettingsStore.setState({ enableSubagents: true, agentAccessMode: 'auto' });

    const mockAgents = [
      {
        id: 'parent-agent',
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

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_agent') return mockAgents[0];
      if (cmd === 'get_agents') return mockAgents;
      if (cmd === 'load_ai_config') return '{}';
      if (cmd === 'set_sandbox_context') return null;
      if (cmd === 'begin_sandbox_execution') return null;
      if (cmd === 'end_sandbox_execution') return null;
      return null;
    });

    parentContext = {
      agentId: 'parent-agent',
      baseDir: 'D:/test-workspace',
      parentProvider: 'openai',
      parentModel: 'openai:gpt-test',
      onRequestToolApproval: vi.fn(),
    };
  });

  const mockOnRequestToolApprovalWithStore = (choice: 'approve' | 'reject') =>
    vi.fn(async (req: { taskId: string; toolName: string; detailPreview: string }) => {
      return new Promise<'approve' | 'reject'>((resolve) => {
        useSubagentStore.getState().setPendingApproval(req.taskId, {
          toolName: req.toolName,
          detailPreview: req.detailPreview,
          resolve: (c) => {
            useSubagentStore.getState().clearPendingApproval(req.taskId);
            resolve(c);
          },
        });
        queueMicrotask(() => {
          useSubagentStore.getState().runs[req.taskId]?.pendingApproval?.resolve(choice);
        });
      });
    });

  const setupMockAIStream = (toolCall: any) => {
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_agents') {
        return [
          {
            id: 'parent-agent',
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
      }
      if (cmd === 'load_ai_config') return '{}';
      if (cmd === 'set_sandbox_context') return null;
      if (cmd === 'begin_sandbox_execution') return null;
      if (cmd === 'end_sandbox_execution') return null;
      if (cmd === 'send_ai_chat_stream') {
        const msgId = args.messageId;
        const messages = args.messages || [];
        const lastMsg = messages[messages.length - 1];
        const isSubsequentRound = lastMsg && lastMsg.role === 'tool';

        setTimeout(() => {
          emitEvent('ai-stream-chunk', {
            message_id: msgId,
            chunk: 'Executing tool call...',
            chunk_type: 'content',
          });

          emitEvent('ai-stream-complete', {
            message_id: msgId,
            tool_calls: !isSubsequentRound && toolCall ? [toolCall] : [],
          });
        }, 5);
      }
      return {};
    });
  };

  it('should run automatically without approval when agentAccessMode is full_access', async () => {
    useSettingsStore.setState({ agentAccessMode: 'full_access' });
    setupMockAIStream({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'write',
        arguments: JSON.stringify({ path: 'hello.txt', content: 'test' }),
      },
    });

    const result = await handler.execute({ task: 'Write hello' }, parentContext);

    expect(parentContext.onRequestToolApproval).not.toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Executing tool call...');
  });

  it('should immediately deny and return explanation when agentAccessMode is read_only', async () => {
    useSettingsStore.setState({ agentAccessMode: 'read_only' });
    setupMockAIStream({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'write',
        arguments: JSON.stringify({ path: 'hello.txt', content: 'test' }),
      },
    });

    const result = await handler.execute({ task: 'Write hello' }, parentContext);

    expect(parentContext.onRequestToolApproval).not.toHaveBeenCalled();
    // Denied execution: does not crash the loop, returns explanation
    expect(result.output).toContain('Executing tool call...');
    // Since write was denied, it returns denied text
    const runs = useSubagentStore.getState().runs;
    const runId = Object.keys(runs)[0];
    const run = runs[runId];
    expect(run.toolEvents?.[0]?.status).toBe('error');
    expect(run.toolEvents?.[0]?.resultPreview).toContain('访问档位');
  });

  it('should bubble up to parent context when agentAccessMode is auto and user approves command', async () => {
    useSettingsStore.setState({ agentAccessMode: 'auto' });
    parentContext.onRequestToolApproval = mockOnRequestToolApprovalWithStore('approve');
    // Default guard policy only requires confirmation for critical patterns
    // (not benign commands like `npm test`).
    setupMockAIStream({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'term',
        arguments: JSON.stringify({ command: 'rm -rf /' }),
      },
    });

    const result = await handler.execute({ task: 'Dangerous cleanup' }, parentContext);

    expect(parentContext.onRequestToolApproval).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    const runs = useSubagentStore.getState().runs;
    const runId = Object.keys(runs)[0];
    const run = runs[runId];
    expect(run.toolEvents?.[0]?.status).toBe('done');
    expect(run.pendingApproval).toBeUndefined();
  });

  it('should bubble up to parent context when agentAccessMode is auto and user rejects command', async () => {
    useSettingsStore.setState({ agentAccessMode: 'auto' });
    parentContext.onRequestToolApproval = mockOnRequestToolApprovalWithStore('reject');
    setupMockAIStream({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'term',
        arguments: JSON.stringify({ command: 'rm -rf /' }),
      },
    });

    await handler.execute({ task: 'Dangerous cleanup' }, parentContext);

    expect(parentContext.onRequestToolApproval).toHaveBeenCalled();
    const runs = useSubagentStore.getState().runs;
    const runId = Object.keys(runs)[0];
    const run = runs[runId];
    expect(run.toolEvents?.[0]?.status).toBe('error');
    expect(run.toolEvents?.[0]?.resultPreview).toMatch(/拒绝|denied|reject/i);
    expect(run.pendingApproval).toBeUndefined();
  });

  it('should bypass approval for read-only tools even when agentAccessMode is auto', async () => {
    useSettingsStore.setState({ agentAccessMode: 'auto' });
    setupMockAIStream({
      id: 'tool-read-1',
      type: 'function',
      function: {
        name: 'read',
        arguments: JSON.stringify({ path: 'hello.txt' }),
      },
    });

    await handler.execute({ task: 'Read hello' }, parentContext);

    expect(parentContext.onRequestToolApproval).not.toHaveBeenCalled();
    const runs = useSubagentStore.getState().runs;
    const runId = Object.keys(runs)[0];
    const run = runs[runId];
    expect(run.toolEvents?.[0]?.status).toBe('done');
  });

  it('should cancel a running subagent individually', async () => {
    // We mock the AI stream to execute a tool, but cancel it midway
    setupMockAIStream({
      id: 'tool-loop-1',
      type: 'function',
      function: {
        name: 'write',
        arguments: JSON.stringify({ path: 'test.txt', content: 'test' }),
      },
    });

    // Cancel immediately after start
    const promise = handler.execute({ task: 'Long task' }, parentContext);

    // Get taskId from store to cancel it
    setTimeout(() => {
      const runs = useSubagentStore.getState().runs;
      const runId = Object.keys(runs)[0];
      useSubagentStore.getState().cancelSubagent(runId);
    }, 1);

    const result = await promise;

    expect(result.error).toContain('Subagent loop aborted by user');
    const runs = useSubagentStore.getState().runs;
    const runId = Object.keys(runs)[0];
    const run = runs[runId];
    expect(run.status).toBe('cancelled');
    expect(run.result?.summary).toContain('已被用户取消');
  });

  it('should cancel multiple subagents in batch', async () => {
    setupMockAIStream({
      id: 'tool-loop-2',
      type: 'function',
      function: {
        name: 'write',
        arguments: JSON.stringify({ path: 'test2.txt', content: 'test' }),
      },
    });

    const promise = batchHandler.execute(
      {
        tasks: [{ task: 'Task A' }, { task: 'Task B' }],
      },
      parentContext
    );

    setTimeout(() => {
      useSubagentStore.getState().cancelAllSubagents();
    }, 1);

    const result = await promise;

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('取消 2');
    expect(result.output).toContain('已取消】Task A');
    expect(result.output).toContain('已取消】Task B');
  });

  it('should support async background subagents returning handle immediately', async () => {
    setupMockAIStream(null);

    const result = await handler.execute({ task: 'Async work', async: true }, parentContext);

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('子代理已在后台启动');

    await vi.waitFor(() => {
      expect(Object.keys(useSubagentStore.getState().runs).length).toBe(1);
    });
  });
});
