import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { runAgentLoop } from '../runAgentLoop';
import { executeToolCall } from '../aiTools/toolExecutor';
import { useSettingsStore } from '../../stores/useSettingsStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Set());
    }
    listeners.get(eventName)!.add(callback);
    return () => {
      listeners.get(eventName)?.delete(callback);
    };
  }),
}));

const emitEvent = (eventName: string, payload: unknown) => {
  const callbacks = listeners.get(eventName);
  if (!callbacks) return;
  for (const cb of callbacks) {
    cb({ payload });
  }
};

vi.mock('../aiTools/toolExecutor', () => ({
  executeToolCall: vi.fn(async (toolCall: { id: string }) => ({
    tool_call_id: toolCall.id,
    output: 'mock output',
  })),
}));

describe('runAgentLoop', () => {
  let streamCallCount = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    streamCallCount = 0;
    useSettingsStore.setState({ agentAccessMode: 'full_access' });

    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      const invokeArgs = args as Record<string, unknown> | undefined;
      if (cmd === 'get_app_data_path') return 'C:/app-data';
      if (cmd === 'set_sandbox_context') return null;
      if (cmd === 'read_folder_children') return [];
      if (cmd === 'send_ai_chat_stream') {
        const messageId = invokeArgs?.messageId as string;
        streamCallCount += 1;
        setTimeout(() => {
          if (streamCallCount === 1) {
            emitEvent('ai-stream-chunk', {
              message_id: messageId,
              chunk:
                '<tool_call><function=bash><parameter=command>ls</parameter></function></tool_call>',
              chunk_type: 'content',
            });
            setTimeout(() => {
              emitEvent('ai-stream-complete', {
                message_id: messageId,
                tool_calls: [],
              });
            }, 0);
            return;
          }

          emitEvent('ai-stream-chunk', {
            message_id: messageId,
            chunk: 'Done listing files.',
            chunk_type: 'content',
          });
          setTimeout(() => {
            emitEvent('ai-stream-complete', {
              message_id: messageId,
              tool_calls: [],
            });
          }, 0);
        }, 0);
      }
      return null;
    });
  });

  it('executes native tool calls from ai-stream-complete', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      const invokeArgs = args as Record<string, unknown> | undefined;
      if (cmd === 'get_app_data_path') return 'C:/app-data';
      if (cmd === 'set_sandbox_context') return null;
      if (cmd === 'read_folder_children') return [];
      if (cmd === 'send_ai_chat_stream') {
        const messageId = invokeArgs?.messageId as string;
        streamCallCount += 1;
        setTimeout(() => {
          if (streamCallCount === 1) {
            emitEvent('ai-stream-chunk', {
              message_id: messageId,
              chunk: 'Listing directory.',
              chunk_type: 'content',
            });
            setTimeout(() => {
              emitEvent('ai-stream-complete', {
                message_id: messageId,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'finfo',
                      arguments: JSON.stringify({ action: 'list', path: '.' }),
                    },
                  },
                ],
              });
            }, 0);
            return;
          }

          emitEvent('ai-stream-chunk', {
            message_id: messageId,
            chunk: 'Done listing files.',
            chunk_type: 'content',
          });
          setTimeout(() => {
            emitEvent('ai-stream-complete', {
              message_id: messageId,
              tool_calls: [],
            });
          }, 0);
        }, 0);
      }
      return null;
    });

    const result = await runAgentLoop({
      systemPrompt: 'You are a helper',
      initialUserMessage: 'List files',
      tools: [
        {
          name: 'finfo',
          description: 'File info',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      model: 'gpt-test',
      provider: 'openai',
      context: { baseDir: 'D:/workspace', profileId: 'profile-1' },
      maxRounds: 3,
      taskId: 'sub-task-1',
    });

    expect(result.steps).toBeGreaterThan(0);
    expect(executeToolCall).toHaveBeenCalled();
    expect(result.finalText).toBe('Done listing files.');

    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'send_ai_chat_stream',
      expect.objectContaining({
        profileId: 'profile-1',
        toolChainConfig: expect.objectContaining({
          enableBackendOrchestration: false,
          appDataPath: 'C:/app-data',
        }),
      })
    );
  });

  it('skips duplicate tool calls with the same name and arguments', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      const invokeArgs = args as Record<string, unknown> | undefined;
      if (cmd === 'get_app_data_path') return 'C:/app-data';
      if (cmd === 'set_sandbox_context') return null;
      if (cmd === 'send_ai_chat_stream') {
        const messageId = invokeArgs?.messageId as string;
        streamCallCount += 1;
        setTimeout(() => {
          const toolCall = {
            id: `call-${streamCallCount}`,
            type: 'function' as const,
            function: {
              name: 'read',
              arguments: JSON.stringify({ path: 'package.json' }),
            },
          };

          emitEvent('ai-stream-chunk', {
            message_id: messageId,
            chunk: streamCallCount === 1 ? 'Reading package.json' : 'Reading again',
            chunk_type: 'content',
          });
          setTimeout(() => {
            emitEvent('ai-stream-complete', {
              message_id: messageId,
              tool_calls: [toolCall],
            });
          }, 0);
        }, 0);
      }
      return null;
    });

    const result = await runAgentLoop({
      systemPrompt: 'You are a helper',
      initialUserMessage: 'Read package.json',
      tools: [
        {
          name: 'read',
          description: 'Read file',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      model: 'gpt-test',
      provider: 'openai',
      context: { baseDir: 'D:/workspace' },
      maxRounds: 5,
      taskId: 'sub-task-dup',
    });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(streamCallCount).toBe(2);
    expect(result.steps).toBe(2);
  });

  it('executes compat JSON tool calls when native tool_calls are missing', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      const invokeArgs = args as Record<string, unknown> | undefined;
      if (cmd === 'get_app_data_path') return 'C:/app-data';
      if (cmd === 'set_sandbox_context') return null;
      if (cmd === 'send_ai_chat_stream') {
        const messageId = invokeArgs?.messageId as string;
        streamCallCount += 1;
        setTimeout(() => {
          if (streamCallCount === 1) {
            emitEvent('ai-stream-chunk', {
              message_id: messageId,
              chunk: '{ "name": "list_directory", "arguments": { "path": "." } }',
              chunk_type: 'content',
            });
            setTimeout(() => {
              emitEvent('ai-stream-complete', {
                message_id: messageId,
                tool_calls: [],
              });
            }, 0);
            return;
          }

          emitEvent('ai-stream-chunk', {
            message_id: messageId,
            chunk: 'Directory listed.',
            chunk_type: 'content',
          });
          setTimeout(() => {
            emitEvent('ai-stream-complete', {
              message_id: messageId,
              tool_calls: [],
            });
          }, 0);
        }, 0);
      }
      return null;
    });

    const result = await runAgentLoop({
      systemPrompt: 'You are a helper',
      initialUserMessage: 'List files',
      tools: [
        {
          name: 'finfo',
          description: 'File info',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      model: 'gpt-test',
      provider: 'openai',
      context: { baseDir: 'D:/workspace' },
      maxRounds: 3,
      taskId: 'sub-task-json',
    });

    expect(result.steps).toBeGreaterThan(0);
    expect(executeToolCall).toHaveBeenCalled();
    expect(result.finalText).toBe('Directory listed.');
  });
});
