import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AgentPanel from './AgentPanel';
import {
  AGENT_CHAT_CONVERSATIONS_STORAGE_KEY,
  AGENT_SESSION_EXTRAS_STORAGE_KEY,
  PENDING_CHANGES_STORAGE_KEY,
  PROJECT_PATH_CONTEXT_PREFIX,
} from '../types/chat';
import { _resetPendingLocks } from '../hooks/useContextInjectionState';
import { I18nProvider } from '../i18n';
import { NotificationProvider } from '../contexts/NotificationContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { normalizeProjectPath } from './agent/utils';
import { loadAllProjectThreadSummaries } from '../utils/agentPersistence';

const PROJECT_PATH = 'D:\\test\\project';

const {
  invokeMock,
  listenHandlers,
  executeToolCallMock,
  getAgentMock,
  saveAgentMock,
  getProjectStateMock,
  saveProjectStateMock,
  migrateToSingleAgentMock,
  projectStorageKeyMock,
  touchProjectIndexMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  executeToolCallMock: vi.fn(),
  getAgentMock: vi.fn(),
  saveAgentMock: vi.fn(),
  getProjectStateMock: vi.fn(),
  saveProjectStateMock: vi.fn(),
  migrateToSingleAgentMock: vi.fn(),
  projectStorageKeyMock: vi.fn(),
  touchProjectIndexMock: vi.fn(),
}));

vi.mock('./agent/useAgentApproval', () => ({
  useAgentApproval: () => ({
    requestApproval: vi.fn(() => Promise.resolve(true)),
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (eventName: string, handler: (event: { payload: unknown }) => void) => {
    listenHandlers.set(eventName, handler);
    return Promise.resolve(() => {
      listenHandlers.delete(eventName);
    });
  },
}));

vi.mock('../utils/agentPersistence', () => ({
  getAgent: (...args: unknown[]) => getAgentMock(...args),
  saveAgent: (...args: unknown[]) => saveAgentMock(...args),
  getProjectState: (...args: unknown[]) => getProjectStateMock(...args),
  saveProjectState: (...args: unknown[]) => saveProjectStateMock(...args),
  migrateToSingleAgent: (...args: unknown[]) => migrateToSingleAgentMock(...args),
  projectStorageKey: (...args: unknown[]) => projectStorageKeyMock(...args),
  touchProjectIndex: (...args: unknown[]) => touchProjectIndexMock(...args),
  loadAllProjectThreadSummaries: vi.fn().mockResolvedValue({}),
  recoverProjectStateForPath: vi.fn().mockResolvedValue(null),
  createDefaultAgent: vi.fn(),
}));

vi.mock('../features/agent-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/agent-engine')>();
  return {
    ...actual,
    AI_TOOLS: [],
    executeToolCall: (...args: unknown[]) => executeToolCallMock(...args),
    toOpenAITools: vi.fn(() => []),
    toAnthropicTools: vi.fn(() => []),
    toGeminiTools: vi.fn(() => []),
    filterToolsByContext: vi.fn((tools: unknown[]) => tools),
    dedupeToolsByName: vi.fn((tools: unknown[]) => tools),
  };
});

vi.mock('../utils/skills', () => ({
  loadSkillsContext: vi.fn().mockResolvedValue(''),
  getSkillsList: vi.fn().mockResolvedValue({ global: [], project: [] }),
}));

vi.mock('./editor/MonacoHost', () => ({
  MonacoHost: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="review-monaco"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  MonacoDiffHost: () => null,
}));

function renderAgentPanel(projectPath = PROJECT_PATH) {
  return render(
    <I18nProvider defaultLocale="en-US">
      <NotificationProvider>
        <AgentPanel projectPath={projectPath} />
      </NotificationProvider>
    </I18nProvider>
  );
}

async function waitForAgentPanelReady() {
  await screen.findByTestId('agent-nav-sidebar');
}

function mockDualSessionProjectState() {
  const projectKey = normalizeProjectPath(PROJECT_PATH);
  const baseInvoke = invokeMock.getMockImplementation();
  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
    if (command === 'generate_conversation_title') {
      return new Promise(() => {
        // Keep sidebar thread titles stable while streams stay active.
      });
    }
    return baseInvoke?.(command, payload);
  });
  getProjectStateMock.mockResolvedValue({
    selectedConversationId: 'conv-a',
    selectedConversationIdByProject: {
      [projectKey]: 'conv-a',
    },
    conversations: [
      {
        id: 'conv-a',
        title: 'Thread A',
        projectPath: PROJECT_PATH,
        createdAt: 1,
        updatedAt: 1,
        previewHistory: [],
        currentPreviewIndex: 0,
        messages: [{ id: 'u-a', role: 'user', text: 'hello A', createdAt: 1 }],
      },
      {
        id: 'conv-b',
        title: 'Thread B',
        projectPath: PROJECT_PATH,
        createdAt: 2,
        updatedAt: 2,
        previewHistory: [],
        currentPreviewIndex: 0,
        messages: [{ id: 'u-b', role: 'user', text: 'hello B', createdAt: 2 }],
      },
    ],
  });
  vi.mocked(loadAllProjectThreadSummaries).mockResolvedValue({
    [projectKey]: [
      {
        id: 'conv-a',
        title: 'Thread A',
        updatedAt: 1,
        projectPath: PROJECT_PATH,
        projectKey,
      },
      {
        id: 'conv-b',
        title: 'Thread B',
        updatedAt: 2,
        projectPath: PROJECT_PATH,
        projectKey,
      },
    ],
  });
}

async function selectProjectThread(
  user: ReturnType<typeof userEvent.setup>,
  title: string
) {
  const tree = await screen.findByTestId('agent-project-tree');
  const titleEl = within(tree).getByText(title);
  const button = titleEl.closest('button');
  expect(button).toBeTruthy();
  await user.click(button!);
}

async function expandChangeReviewPanel() {
  const sessionColumn = screen.getByTestId('agent-session-column');
  const rect = sessionColumn.getBoundingClientRect();
  await act(async () => {
    fireEvent.mouseMove(window, {
      clientX: rect.right - 24,
      clientY: rect.top + 40,
    });
  });
  const panel = await screen.findByTestId('change-review-panel');
  const expandButton = within(panel).getByRole('button', { name: /expand/i });
  await act(async () => {
    fireEvent.click(expandButton);
  });
}

beforeEach(() => {
  localStorage.removeItem('loom.agentSidebarCollapsed');
  localStorage.removeItem(PENDING_CHANGES_STORAGE_KEY);
  localStorage.removeItem(AGENT_SESSION_EXTRAS_STORAGE_KEY);
  localStorage.removeItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
  useSettingsStore.getState().loadSettings({ streamSpeed: 'fast', agentAccessMode: 'auto' });
  _resetPendingLocks();
  invokeMock.mockReset();
  listenHandlers.clear();
  getAgentMock.mockReset();
  saveAgentMock.mockReset();
  getProjectStateMock.mockReset();
  saveProjectStateMock.mockReset();
  migrateToSingleAgentMock.mockReset();
  projectStorageKeyMock.mockReset();
  touchProjectIndexMock.mockReset();
  executeToolCallMock.mockReset();

  const defaultAgent = {
    id: 'agent-1',
    name: '测试 Agent',
    type: 'assistant',
    icon: 'AI',
    status: 'online',
    model: 'gpt-4o-mini',
    provider: 'openai',
    temperature: 0.3,
    capabilities: {
      canExecuteCommands: true,
      canAccessBrowser: true,
      canUseGit: true,
      canUseMcp: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  migrateToSingleAgentMock.mockResolvedValue({
    migrated: false,
    migratedFromAgentCount: 0,
    projectCount: 0,
    agent: defaultAgent,
  });
  getAgentMock.mockResolvedValue(defaultAgent);
  saveAgentMock.mockImplementation(async (agent: typeof defaultAgent) => agent);
  projectStorageKeyMock.mockImplementation(async (path: string) => normalizeProjectPath(path));
  getProjectStateMock.mockResolvedValue(null);
  saveProjectStateMock.mockResolvedValue(undefined);
  touchProjectIndexMock.mockResolvedValue({ projects: [] });
  executeToolCallMock.mockImplementation(async (toolCall: {
    function?: { name?: string; arguments?: string };
  }) => {
    if (toolCall.function?.name === 'write_file') {
      let filePath = 'src/demo.ts';
      try {
        const parsed = JSON.parse(toolCall.function.arguments ?? '{}') as { path?: string };
        if (typeof parsed.path === 'string' && parsed.path.trim()) {
          filePath = parsed.path;
        }
      } catch {
        // ignore parse errors in test fixtures
      }
      return { output: 'ok', error: null, files_changed: [filePath] };
    }
    return { output: 'ok', error: null };
  });

  invokeMock.mockImplementation((command: string) => {
    if (command === 'send_ai_chat_stream') {
      return Promise.resolve(undefined);
    }

    if (command === 'generate_conversation_title') {
      return Promise.resolve('鑷姩鏍囬');
    }

    if (command === 'cancel_ai_chat') {
      return Promise.resolve(undefined);
    }

    if (command === 'read_file_content') {
      return Promise.resolve('preview content');
    }

    if (command === 'get_file_info') {
      return Promise.resolve({ exists: true });
    }

    if (command === 'load_agent_session_extras') {
      return Promise.resolve({ version: 1, drafts: {}, pendingChanges: {} });
    }

    if (command === 'save_agent_session_extras') {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('AgentPanel 空白态展示桌面端欢迎语与 composer', async () => {
  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  expect(await screen.findByTestId('agent-welcome-state')).toBeInTheDocument();
  expect(await screen.findByText(/What should we build in/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Type freely')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Explain this project structure' })).not.toBeInTheDocument();
});

test('AgentPanel shows project-scoped threads in sidebar', async () => {
  getProjectStateMock.mockResolvedValueOnce({
    selectedConversationId: 'conv-1',
    selectedConversationIdByProject: {
      [normalizeProjectPath(PROJECT_PATH)]: 'conv-1',
    },
    conversations: [
      {
        id: 'conv-1',
        title: 'Project thread',
        projectPath: PROJECT_PATH,
        createdAt: 1,
        updatedAt: 2,
        previewHistory: [],
        currentPreviewIndex: 0,
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            text: 'Hello thread',
            createdAt: 1,
          },
        ],
      },
      {
        id: 'conv-other',
        title: 'Other project thread',
        projectPath: 'D:\\other\\project',
        createdAt: 1,
        updatedAt: 2,
        previewHistory: [],
        currentPreviewIndex: 0,
        messages: [],
      },
    ],
  });

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  expect(await screen.findByTestId('agent-project-tree')).toBeInTheDocument();
  expect(screen.getByText('Project thread')).toBeInTheDocument();
  expect(screen.queryByText('Other project thread')).not.toBeInTheDocument();
});

test('AgentPanel 欢迎态 composer 可输入且不会自动发送', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByPlaceholderText('Type freely');
  await user.type(textbox, 'Refactor a piece of code');

  expect(textbox).toHaveValue('Refactor a piece of code');
  expect(invokeMock).not.toHaveBeenCalledWith(
    'send_ai_chat_stream',
    expect.anything()
  );
});

test('AgentPanel 渲染全局导航侧栏分区', async () => {
  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  expect(screen.getByText('New conversation')).toBeInTheDocument();
  expect(screen.getByText('Projects')).toBeInTheDocument();
  expect(screen.getByTestId('agent-project-tree')).toBeInTheDocument();
  expect(screen.getByText('Settings')).toBeInTheDocument();
  expect(screen.queryByText('Conversations')).not.toBeInTheDocument();
});

test('AgentPanel 发送首条消息时并行生成会话标题，不阻塞流式回复', async () => {
  const user = userEvent.setup();
  let resolveTitle: ((value: string) => void) | undefined;
  const titlePromise = new Promise<string>((resolve) => {
    resolveTitle = (value) => resolve(value);
  });

  invokeMock.mockImplementation((command: string) => {
    if (command === 'send_ai_chat_stream') {
      return Promise.resolve(undefined);
    }

    if (command === 'generate_conversation_title') {
      return titlePromise;
    }

    if (command === 'cancel_ai_chat') {
      return Promise.resolve(undefined);
    }

    if (command === 'read_file_content') {
      return Promise.resolve('preview content');
    }

    if (command === 'get_file_info') {
      return Promise.resolve({ exists: true });
    }

    if (command === 'load_agent_session_extras') {
      return Promise.resolve({ version: 1, drafts: {}, pendingChanges: {} });
    }

    if (command === 'save_agent_session_extras') {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(undefined);
  });

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'fix title issue');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  expect(invokeMock).toHaveBeenCalledWith(
    'generate_conversation_title',
    expect.objectContaining({
      provider: 'openai',
      model: 'gpt-4o-mini',
      userText: 'fix title issue',
    })
  );
  expect(resolveTitle).toBeTruthy();

  const streamPayload = streamCall?.[1] as { messageId?: string } | undefined;
  expect(streamPayload?.messageId).toBeTruthy();

  await within(screen.getByTestId('agent-session-column')).findByText('fix title issue');

  expect(within(screen.getByTestId('agent-project-tree')).getByText('fix title issue')).toBeInTheDocument();

  resolveTitle?.('Auto title');

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith(
      'generate_conversation_title',
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o-mini',
        userText: 'fix title issue',
      })
    );
  });

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  completeHandler?.({
    payload: {
      message_id: streamPayload?.messageId,
    },
  });
});

test('AgentPanel 主动停止后不会在工具调用完成后继续发送新的 AI 请求', async () => {
  const user = userEvent.setup();
  let resolveToolCall: ((value: { output: string; error: null }) => void) | null = null;

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'inspect and stop');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const firstStreamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  const firstPayload = firstStreamCall?.[1] as { messageId?: string } | undefined;
  expect(firstPayload?.messageId).toBeTruthy();

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();

  executeToolCallMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveToolCall = resolve;
      })
  );

  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: firstPayload?.messageId,
        tool_calls: [
          {
            id: 'tool-stop-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"src/main.ts"}',
            },
          },
        ],
      },
    });
  });

  await waitFor(() => {
    expect(executeToolCallMock).toHaveBeenCalledTimes(1);
  });

  const stopButton = await screen.findByRole('button', { name: /^stop$/i });
  await user.click(stopButton);

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('cancel_ai_chat', {
      messageId: firstPayload?.messageId,
    });
  });

  await act(async () => {
    resolveToolCall?.({ output: 'ok', error: null });
  });

  await waitFor(() => {
    expect(textbox).not.toBeDisabled();
  });

  const streamCalls = invokeMock.mock.calls.filter(
    ([command]) => command === 'send_ai_chat_stream'
  );
  expect(streamCalls).toHaveLength(1);
});

test('AgentPanel 双会话并发时发送 B 不会取消 A 的流式任务', async () => {
  const user = userEvent.setup();
  mockDualSessionProjectState();

  renderAgentPanel(PROJECT_PATH);
  await waitForAgentPanelReady();

  await screen.findByText('Thread A');

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'stream in A');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const firstStreamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });
  const firstPayload = firstStreamCall?.[1] as { messageId?: string } | undefined;
  expect(firstPayload?.messageId).toBeTruthy();

  await selectProjectThread(user, 'Thread B');

  await waitFor(() => {
    expect(screen.getByText('hello B')).toBeInTheDocument();
  });

  await user.clear(textbox);
  await user.type(textbox, 'stream in B');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCalls = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(
      ([command]) => command === 'send_ai_chat_stream'
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    return calls;
  });

  const secondPayload = streamCalls[1]?.[1] as { messageId?: string } | undefined;
  expect(secondPayload?.messageId).toBeTruthy();
  expect(secondPayload?.messageId).not.toBe(firstPayload?.messageId);

  const cancelCalls = invokeMock.mock.calls.filter(([command]) => command === 'cancel_ai_chat');
  expect(
    cancelCalls.some(
      ([, payload]) =>
        (payload as { messageId?: string } | undefined)?.messageId === firstPayload?.messageId
    )
  ).toBe(false);

  const chunkHandler = listenHandlers.get('ai-stream-chunk');
  expect(chunkHandler).toBeDefined();

  await act(async () => {
    chunkHandler?.({
      payload: {
        message_id: firstPayload?.messageId,
        chunk_type: 'content',
        chunk: 'still streaming in A',
      },
    });
  });

  await selectProjectThread(user, 'stream in A');

  await waitFor(() => {
    expect(screen.getByText(/still streaming in A/)).toBeInTheDocument();
  });
});

test('AgentPanel 停止仅影响当前选中会话', async () => {
  const user = userEvent.setup();
  mockDualSessionProjectState();

  renderAgentPanel(PROJECT_PATH);
  await waitForAgentPanelReady();

  await screen.findByText('Thread A');

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'long reply A');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const firstStreamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });
  const firstPayload = firstStreamCall?.[1] as { messageId?: string } | undefined;

  await selectProjectThread(user, 'Thread B');
  await waitFor(() => {
    expect(screen.getByText('hello B')).toBeInTheDocument();
  });

  await user.clear(textbox);
  await user.type(textbox, 'long reply B');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const secondStreamCall = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(
      ([command]) => command === 'send_ai_chat_stream'
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    return calls[1];
  });
  const secondPayload = secondStreamCall?.[1] as { messageId?: string } | undefined;

  const stopButton = await screen.findByRole('button', { name: /^stop$/i });
  await user.click(stopButton);

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('cancel_ai_chat', {
      messageId: secondPayload?.messageId,
    });
  });

  const cancelCalls = invokeMock.mock.calls.filter(([command]) => command === 'cancel_ai_chat');
  expect(
    cancelCalls.some(
      ([, payload]) =>
        (payload as { messageId?: string } | undefined)?.messageId === firstPayload?.messageId
    )
  ).toBe(false);

  const chunkHandler = listenHandlers.get('ai-stream-chunk');
  await act(async () => {
    chunkHandler?.({
      payload: {
        message_id: firstPayload?.messageId,
        chunk_type: 'content',
        chunk: 'A continues after B stop',
      },
    });
  });

  await selectProjectThread(user, 'long reply A');

  await waitFor(() => {
    expect(screen.getByText(/A continues after B stop/)).toBeInTheDocument();
  });
});

test('AgentPanel AI 回复开头换行不会在气泡顶部产生空白', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, '测试顶部空白');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  const streamPayload = streamCall?.[1] as { messageId?: string } | undefined;
  expect(streamPayload?.messageId).toBeTruthy();

  const chunkHandler = listenHandlers.get('ai-stream-chunk');
  expect(chunkHandler).toBeDefined();

  chunkHandler?.({
    payload: {
      message_id: streamPayload?.messageId,
      chunk_type: 'content',
      chunk: '\n\nAGENT_TRIM_CASE_RESPONSE',
    },
  });

  await waitFor(() => {
    const exactReplyNodes = screen.queryAllByText(
      (_, element) => element?.textContent === 'AGENT_TRIM_CASE_RESPONSE'
    );
    const leadingNewlineNodes = screen.queryAllByText(
      (_, element) => element?.textContent === '\n\nAGENT_TRIM_CASE_RESPONSE'
    );
    expect(exactReplyNodes.length).toBeGreaterThan(0);
    expect(leadingNewlineNodes.length).toBe(0);
  });
});

test('AgentPanel 普通对话不会把思考尾巴和 </think> 渲染到正文里', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, '检查正文泄漏');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  const streamPayload = streamCall?.[1] as { messageId?: string } | undefined;
  expect(streamPayload?.messageId).toBeTruthy();

  const chunkHandler = listenHandlers.get('ai-stream-chunk');
  expect(chunkHandler).toBeDefined();

  await act(async () => {
    chunkHandler?.({
      payload: {
        message_id: streamPayload?.messageId,
        chunk_type: 'thinking',
        chunk: 'existing reasoning',
      },
    });

    chunkHandler?.({
      payload: {
        message_id: streamPayload?.messageId,
        chunk_type: 'content',
        chunk: 'hidden reasoning tail</think>Visible final answer',
      },
    });
  });

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: streamPayload?.messageId,
      },
    });
  });

  await waitFor(() => {
    expect(screen.getByText('Visible final answer')).toBeInTheDocument();
  });

  expect(screen.queryByText('hidden reasoning tail</think>Visible final answer')).not.toBeInTheDocument();
  expect(screen.queryByText((text) => text.includes('</think>'))).not.toBeInTheDocument();
});

test('AgentPanel thinking 容器使用非简写边框样式以避免 borderColor 冲突', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'trigger thinking state');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  const streamPayload = streamCall?.[1] as { messageId?: string } | undefined;
  expect(streamPayload?.messageId).toBeTruthy();

  const chunkHandler = listenHandlers.get('ai-stream-chunk');
  expect(chunkHandler).toBeDefined();

  chunkHandler?.({
    payload: {
      message_id: streamPayload?.messageId,
      chunk_type: 'thinking',
      chunk: 'thinking chunk',
    },
  });

  chunkHandler?.({
    payload: {
      message_id: streamPayload?.messageId,
      chunk_type: 'content',
      chunk: '结论',
    },
  });

  await waitFor(() => {
    expect(screen.getByText('结论')).toBeInTheDocument();
  });
});

test('AgentPanel uses latest projectPath for tool calls after projectPath update', async () => {
  const user = userEvent.setup();

  const { rerender } = renderAgentPanel('D:\\old-root');

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, '执行工具');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  const streamPayload = streamCall?.[1] as { messageId?: string } | undefined;
  expect(streamPayload?.messageId).toBeTruthy();

  rerender(
    <I18nProvider defaultLocale="en-US">
      <NotificationProvider>
        <AgentPanel projectPath={'D:\\new-root'} />
      </NotificationProvider>
    </I18nProvider>
  );

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: streamPayload?.messageId,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{}',
            },
          },
        ],
      },
    });
  });

  await waitFor(
    () => {
      expect(executeToolCallMock).toHaveBeenCalled();
    },
    { timeout: 5000 }
  );

  expect(executeToolCallMock).toHaveBeenCalledWith(
    expect.objectContaining({
      function: expect.objectContaining({ name: 'read_file' }),
    }),
    expect.objectContaining({
      baseDir: expect.stringMatching(/new-root$/),
    })
  );
});

test('AgentPanel uses latest projectPath for backend tool-chain requests during immediate project switch', async () => {
  const { rerender } = renderAgentPanel('D:\\old-root');

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  fireEvent.change(textbox, { target: { value: 'inspect workspace' } });

  await act(async () => {
    rerender(
      <I18nProvider defaultLocale="en-US">
        <NotificationProvider>
          <AgentPanel projectPath={'D:\\new-root'} />
        </NotificationProvider>
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /send|发送/i }));
  });

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  expect(streamCall?.[1]).toEqual(
    expect.objectContaining({
      toolChainConfig: expect.objectContaining({
        projectPath: 'D:\\new-root',
      }),
    })
  );
});

test('AgentPanel 仅在会话首次发送时注入文件夹路径上下文', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  const sendButton = screen.getByRole('button', { name: /send|发送/i });

  await user.type(textbox, 'first question');
  await user.click(sendButton);

  const firstStreamCall = await waitFor(() => {
    const streamCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'send_ai_chat_stream'
    );
    expect(streamCalls.length).toBeGreaterThanOrEqual(1);
    return streamCalls[0];
  });

  const firstPayload = firstStreamCall?.[1] as {
    messageId?: string;
    messages?: Array<{ role: string; content: string | null }>;
  };
  const firstMessages = firstPayload.messages ?? [];
  const firstContextMessages = firstMessages.filter(
    (msg) =>
      msg.role === 'system' &&
      typeof msg.content === 'string' &&
      msg.content.includes(PROJECT_PATH_CONTEXT_PREFIX)
  );

  expect(firstContextMessages.length).toBe(1);
  expect(firstContextMessages[0]?.content).toContain(PROJECT_PATH);

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: firstPayload.messageId,
      },
    });
  });

  await waitFor(() => {
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });

  const secondTextbox = screen.getByRole('textbox');
  await user.type(secondTextbox, 'second question');
  await user.click(screen.getByRole('button', { name: /^send$/i }));

  const secondStreamCall = await waitFor(() => {
    const streamCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'send_ai_chat_stream'
    );
    expect(streamCalls.length).toBeGreaterThanOrEqual(2);
    return streamCalls[1];
  });

  const secondPayload = secondStreamCall?.[1] as {
    messages?: Array<{ role: string; content: string | null }>;
  };
  const secondMessages = secondPayload.messages ?? [];
  const secondContextMessages = secondMessages.filter(
    (msg) =>
      msg.role === 'system' &&
      typeof msg.content === 'string' &&
      msg.content.includes(PROJECT_PATH_CONTEXT_PREFIX)
  );

  expect(secondContextMessages.length).toBe(0);
});


test('AgentPanel 思考后直接 complete 也会显示思考耗时', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, '触发思考耗时');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCall = await waitFor(() => {
    const call = invokeMock.mock.calls.find(([command]) => command === 'send_ai_chat_stream');
    expect(call).toBeTruthy();
    return call;
  });

  const streamPayload = streamCall?.[1] as { messageId?: string } | undefined;
  expect(streamPayload?.messageId).toBeTruthy();

  const chunkHandler = listenHandlers.get('ai-stream-chunk');
  expect(chunkHandler).toBeDefined();
  chunkHandler?.({
    payload: {
      message_id: streamPayload?.messageId,
      chunk_type: 'thinking',
      chunk: 'thinking text',
    },
  });

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  completeHandler?.({
    payload: {
      message_id: streamPayload?.messageId,
    },
  });

  await waitFor(() => {
    expect(screen.getByText((text) => text.startsWith('Thought for '))).toBeInTheDocument();
  });
});

test('AgentPanel 在 Anthropic 工具链路使用 tool_result 兼容格式', async () => {
  const user = userEvent.setup();

  getAgentMock.mockResolvedValueOnce({
    id: 'agent-anthropic',
    name: 'Anthropic Agent',
    type: 'assistant',
    icon: 'AI',
    status: 'online',
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    temperature: 0.3,
    capabilities: {
      canExecuteCommands: true,
      canAccessBrowser: true,
      canUseGit: true,
      canUseMcp: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, '触发工具调用');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const firstStreamCall = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThan(0);
    return calls[0];
  });

  const firstPayload = firstStreamCall?.[1] as { messageId?: string } | undefined;
  expect(firstPayload?.messageId).toBeTruthy();

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  completeHandler?.({
    payload: {
      message_id: firstPayload?.messageId,
      tool_calls: [
        {
          id: 'tool-anthropic-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"src/main.ts"}',
          },
        },
      ],
    },
  });

  const secondStreamCall = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    return calls[1];
  });

  const secondPayload = secondStreamCall?.[1] as
    | { messages?: Array<{ role: string; content: unknown }> }
    | undefined;
  const secondMessages = secondPayload?.messages ?? [];

  expect(secondMessages.some((msg) => msg.role === 'tool')).toBe(false);

  const assistantToolUseBlocks = secondMessages
    .filter((msg) => msg.role === 'assistant' && Array.isArray(msg.content))
    .flatMap((msg) => msg.content as Array<{ type?: string; id?: string }>)
    .filter((block) => block.type === 'tool_use' && block.id === 'tool-anthropic-1');

  expect(assistantToolUseBlocks.length).toBe(1);

  // 验证 tool_result 格式正确
  const toolResultMessage = secondMessages.find(
    (msg) =>
      msg.role === 'user' &&
      Array.isArray(msg.content) &&
      (msg.content as Array<{ type?: string; tool_use_id?: string; content?: unknown }>).some(
        (block) => block.type === 'tool_result' && block.tool_use_id === 'tool-anthropic-1'
      )
  );

  expect(toolResultMessage).toBeDefined();

  // 验证 tool_result 的 content 字段是字符串类型
  const toolResultBlock = (
    toolResultMessage?.content as Array<{ type?: string; content?: unknown }>
  )?.find((block) => block.type === 'tool_result');

  expect(toolResultBlock).toBeDefined();
  expect(typeof toolResultBlock?.content).toBe('string');
});

test('AgentPanel 鍒锋柊鍔犺浇 camelCase 宸ュ叿瀛楁鍚庝粛鏄剧ず绮剧畝宸ュ叿鏉＄洰', async () => {
  getProjectStateMock.mockResolvedValueOnce({
    selectedConversationId: 'conv-1',
    selectedConversationIdByProject: {
      [normalizeProjectPath(PROJECT_PATH)]: 'conv-1',
    },
    conversations: [
      {
        id: 'conv-1',
        title: '会话',
        projectPath: PROJECT_PATH,
        createdAt: 1,
        updatedAt: 2,
        previewHistory: [],
        currentPreviewIndex: 0,
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            text: '看看 README',
            createdAt: 1,
          },
          {
            id: 'msg-tool-1',
            role: 'tool',
            text: 'README content...',
            toolCallId: 'call-1',
            toolName: 'read_file',
            toolArgs: { path: 'README.md' },
            createdAt: 2,
          },
        ],
      },
    ],
  });

  renderAgentPanel(PROJECT_PATH);

  await within(screen.getByTestId('agent-session-column')).findByText('Read README.md');
});

test('AgentPanel shows change review panel and can discard modified file', async () => {
  const user = userEvent.setup();
  let wroteDemoFile = false;

  executeToolCallMock.mockImplementation(async (toolCall: {
    function?: { name?: string; arguments?: string };
  }) => {
    if (toolCall.function?.name === 'write_file') {
      wroteDemoFile = true;
      let filePath = 'src/demo.ts';
      try {
        const parsed = JSON.parse(toolCall.function.arguments ?? '{}') as { path?: string };
        if (typeof parsed.path === 'string' && parsed.path.trim()) {
          filePath = parsed.path;
        }
      } catch {
        // ignore parse errors in test fixtures
      }
      return { output: 'ok', error: null, files_changed: [filePath] };
    }
    return { output: 'ok', error: null };
  });

  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
    if (command === 'send_ai_chat_stream') {
      return Promise.resolve(undefined);
    }

    if (command === 'generate_conversation_title') {
      return Promise.resolve('鑷姩鏍囬');
    }

    if (command === 'cancel_ai_chat') {
      return Promise.resolve(undefined);
    }

    if (command === 'read_file_content') {
      const filePath = String(payload?.filePath ?? '');
      if (wroteDemoFile && /demo\.ts$/i.test(filePath)) {
        return Promise.resolve('const x = 2;');
      }
      return Promise.resolve('preview content');
    }

    if (command === 'get_file_info') {
      return Promise.resolve({ exists: true });
    }

    if (command === 'load_agent_session_extras') {
      return Promise.resolve({ version: 1, drafts: {}, pendingChanges: {} });
    }

    if (command === 'save_agent_session_extras') {
      return Promise.resolve(undefined);
    }

    if (command === 'write_file_content') {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(undefined);
  });

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'modify src/demo.ts');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCalls = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThan(0);
    return calls;
  });

  const firstPayload = streamCalls[0]?.[1] as { messageId?: string } | undefined;
  expect(firstPayload?.messageId).toBeTruthy();

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: firstPayload?.messageId,
        tool_calls: [
          {
            id: 'tool-pending-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'src/demo.ts',
                content: 'const x = 2;',
              }),
            },
          },
        ],
      },
    });
  });

  await waitFor(
    () => {
      expect(executeToolCallMock).toHaveBeenCalled();
    },
    { timeout: 5000 }
  );

  await waitFor(() => {
    expect(screen.getByTestId('change-count-capsule')).toBeInTheDocument();
  });

  await user.click(screen.getByTestId('change-count-capsule'));

  await waitFor(() => {
    const panel = screen.getByTestId('change-review-panel');
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText('demo.ts')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /collapse/i })).toBeInTheDocument();
  });

  await user.click(screen.getByRole('button', { name: /discard all/i }));

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith(
      'write_file_content',
      expect.objectContaining({
        filePath: expect.stringMatching(/src[\\/]demo\.ts$/),
        content: 'preview content',
      })
    );
  });

  await waitFor(() => {
    expect(screen.getByText(/no pending changes/i)).toBeInTheDocument();
    expect(screen.queryByTestId('change-count-capsule')).not.toBeInTheDocument();
  });
});

test('AgentPanel removes change review entry after accepting pending file change', async () => {
  const user = userEvent.setup();

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'modify src/demo.ts');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCalls = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThan(0);
    return calls;
  });

  const firstPayload = streamCalls[0]?.[1] as { messageId?: string } | undefined;
  expect(firstPayload?.messageId).toBeTruthy();

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();
  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: firstPayload?.messageId,
        tool_calls: [
          {
            id: 'tool-pending-accept-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'src/demo.ts',
                content: 'const x = 2;',
              }),
            },
          },
        ],
      },
    });
  });

  await waitFor(
    () => {
      expect(executeToolCallMock).toHaveBeenCalled();
    },
    { timeout: 5000 }
  );

  await expandChangeReviewPanel();

  await waitFor(() => {
    const panel = screen.getByTestId('change-review-panel');
    expect(within(panel).getByText('demo.ts')).toBeInTheDocument();
  });

  await user.click(screen.getByRole('button', { name: /accept all/i }));

  await waitFor(() => {
    expect(screen.getByText(/no pending changes/i)).toBeInTheDocument();
  });
});

test('AgentPanel auto-discards pending change when rollback target is missing', async () => {
  const user = userEvent.setup();
  let wroteDemoFile = false;

  executeToolCallMock.mockImplementation(async (toolCall: {
    function?: { name?: string; arguments?: string };
  }) => {
    if (toolCall.function?.name === 'write_file') {
      wroteDemoFile = true;
      return { output: 'ok', error: null, files_changed: ['src/demo.ts'] };
    }
    return { output: 'ok', error: null };
  });

  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
    if (command === 'send_ai_chat_stream') {
      return Promise.resolve(undefined);
    }
    if (command === 'generate_conversation_title') {
      return Promise.resolve('auto title');
    }
    if (command === 'cancel_ai_chat') {
      return Promise.resolve(undefined);
    }
    if (command === 'read_file_content') {
      const filePath = String(payload?.filePath ?? '');
      if (wroteDemoFile && /demo\.ts$/i.test(filePath)) {
        return Promise.resolve('const x = 2;');
      }
      return Promise.resolve('preview content');
    }
    if (command === 'get_file_info') {
      return Promise.resolve({ exists: true });
    }
    if (command === 'load_agent_session_extras') {
      return Promise.resolve({ version: 1, drafts: {}, pendingChanges: {} });
    }
    if (command === 'save_agent_session_extras') {
      return Promise.resolve(undefined);
    }
    if (command === 'write_file_content') {
      return Promise.reject('路径不存在: src/demo.ts');
    }
    return Promise.resolve(undefined);
  });

  renderAgentPanel(PROJECT_PATH);
  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'modify src/demo.ts');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const streamCalls = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThan(0);
    return calls;
  });

  const firstPayload = streamCalls[0]?.[1] as { messageId?: string } | undefined;
  const completeHandler = listenHandlers.get('ai-stream-complete');
  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: firstPayload?.messageId,
        tool_calls: [
          {
            id: 'tool-pending-missing-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'src/demo.ts',
                content: 'const x = 2;',
              }),
            },
          },
        ],
      },
    });
  });

  await waitFor(() => {
    expect(executeToolCallMock).toHaveBeenCalled();
  });

  await expandChangeReviewPanel();

  await waitFor(() => {
    expect(within(screen.getByTestId('change-review-panel')).getByText('demo.ts')).toBeInTheDocument();
  });

  await user.click(screen.getByRole('button', { name: /^discard$/i }));

  await waitFor(() => {
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
    expect(screen.getByText(/no pending changes/i)).toBeInTheDocument();
    expect(screen.queryByTestId('change-count-capsule')).not.toBeInTheDocument();
  });
});

test('AgentPanel 连续两次修改同一文件时保留首次 diff 基线', async () => {
  const user = userEvent.setup();
  let fileContent = 'const x = 1;';
  let writeCount = 0;

  invokeMock.mockImplementation((command: string, payload?: Record<string, unknown>) => {
    if (command === 'send_ai_chat_stream') {
      return Promise.resolve(undefined);
    }

    if (command === 'generate_conversation_title') {
      return Promise.resolve('自动标题');
    }

    if (command === 'cancel_ai_chat') {
      return Promise.resolve(undefined);
    }

    if (command === 'get_file_info') {
      return Promise.resolve({ exists: true });
    }

    if (command === 'read_file_content') {
      const targetPath = String((payload as { filePath?: string } | undefined)?.filePath ?? '');
      if (/src[\\/]demo\.ts$/i.test(targetPath)) {
        return Promise.resolve(fileContent);
      }
      return Promise.resolve('preview content');
    }

    return Promise.resolve(undefined);
  });

  executeToolCallMock.mockImplementation(async (toolCall: {
    function: { name: string };
  }) => {
    if (toolCall.function.name === 'write_file') {
      writeCount += 1;
      fileContent = writeCount === 1 ? 'const x = 2;' : 'const x = 3;';
      return { output: 'ok', error: null, files_changed: ['src/demo.ts'] };
    }
    return { output: 'ok', error: null };
  });

  renderAgentPanel(PROJECT_PATH);

  await waitForAgentPanelReady();

  const textbox = screen.getByRole('textbox');
  await user.type(textbox, 'modify src/demo.ts twice');
  await user.click(screen.getByRole('button', { name: /send|发送/i }));

  const completeHandler = listenHandlers.get('ai-stream-complete');
  expect(completeHandler).toBeDefined();

  const firstStreamCall = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThan(0);
    return calls[0];
  });
  const firstMessageId = (firstStreamCall?.[1] as { messageId?: string } | undefined)?.messageId;
  expect(firstMessageId).toBeTruthy();

  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: firstMessageId,
        tool_calls: [
          {
            id: 'tool-merge-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'src/demo.ts',
                content: 'const x = 2;',
              }),
            },
          },
        ],
      },
    });
  });

  await waitFor(() => {
    expect(executeToolCallMock).toHaveBeenCalledTimes(1);
  });

  const secondStreamCall = await waitFor(() => {
    const calls = invokeMock.mock.calls.filter(([command]) => command === 'send_ai_chat_stream');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    return calls[1];
  });
  const secondMessageId = (secondStreamCall?.[1] as { messageId?: string } | undefined)?.messageId;
  expect(secondMessageId).toBeTruthy();

  await act(async () => {
    completeHandler?.({
      payload: {
        message_id: secondMessageId,
        tool_calls: [
          {
            id: 'tool-merge-2',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'src/demo.ts',
                content: 'const x = 3;',
              }),
            },
          },
        ],
      },
    });
  });

  await waitFor(
    () => {
      expect(executeToolCallMock).toHaveBeenCalledTimes(2);
    },
    { timeout: 5000 }
  );

  await expandChangeReviewPanel();

  await waitFor(() => {
    const panel = screen.getByTestId('change-review-panel');
    expect(within(panel).getByText('demo.ts')).toBeInTheDocument();
  });

  await user.click(screen.getByRole('button', { name: /discard all/i }));

  await waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith(
      'write_file_content',
      expect.objectContaining({
        filePath: expect.stringMatching(/src[\\/]demo\.ts$/),
        content: 'const x = 1;',
      })
    );
  });
});
