import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n';
import { NotificationProvider } from '../contexts/NotificationContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { AGENT_CHAT_CONVERSATIONS_STORAGE_KEY, AGENT_SESSION_EXTRAS_STORAGE_KEY, PENDING_CHANGES_STORAGE_KEY } from '../types/chat';
import { _resetPendingLocks } from '../hooks/useContextInjectionState';
import { normalizeProjectPath } from './agent/utils';
import AgentPanel from './AgentPanel';

const PROJECT_PATH = 'D:\\test\\project';

const {
  invokeMock,
  listenHandlers,
  getAgentMock,
  saveAgentMock,
  getProjectStateMock,
  saveProjectStateMock,
  migrateToSingleAgentMock,
  projectStorageKeyMock,
  touchProjectIndexMock,
  executeToolCallMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  getAgentMock: vi.fn(),
  saveAgentMock: vi.fn(),
  getProjectStateMock: vi.fn(),
  saveProjectStateMock: vi.fn(),
  migrateToSingleAgentMock: vi.fn(),
  projectStorageKeyMock: vi.fn(),
  touchProjectIndexMock: vi.fn(),
  executeToolCallMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: vi.fn((path: string) => path),
  isTauri: vi.fn(() => false),
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
    filterToolsByContext: vi.fn((tools: unknown[]) => tools),
    dedupeToolsByName: vi.fn((tools: unknown[]) => tools),
  };
});

vi.mock('../utils/skills', () => ({
  loadSkillsContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('./agent/useAgentApproval', () => ({
  useAgentApproval: () => ({
    requestApproval: vi.fn(() => Promise.resolve(true)),
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));

vi.mock('../stores/useToolStore', () => ({
  useToolStore: (selector: (state: unknown) => unknown) =>
    selector({
      mcpTools: [],
      isFetchingMcpTools: false,
      fetchMcpTools: vi.fn(),
      clearMcpTools: vi.fn(),
    }),
}));

vi.mock('../stores/useComposerStore', () => ({
  useComposerStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      currentSession: null,
      sessions: [],
      isSyncing: false,
      setVisibility: vi.fn(),
      selectFile: vi.fn(),
      loadSession: vi.fn(),
      commitSession: vi.fn(),
      rollbackSession: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('./FilePreviewPanel', () => ({
  default: () => null,
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
    <NotificationProvider>
      <I18nProvider defaultLocale="en-US">
        <AgentPanel projectPath={projectPath} />
      </I18nProvider>
    </NotificationProvider>
  );
}

describe('AgentPanel MCP tool rendering', () => {
  beforeEach(() => {
    localStorage.removeItem(PENDING_CHANGES_STORAGE_KEY);
    localStorage.removeItem(AGENT_SESSION_EXTRAS_STORAGE_KEY);
    localStorage.removeItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
    _resetPendingLocks();
    useSettingsStore.getState().loadSettings({ streamSpeed: 'fast', agentAccessMode: 'auto' });
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
      name: 'Test Agent',
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
    executeToolCallMock.mockResolvedValue({ output: 'ok', error: null });

    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('shows the dedicated MCP result card for MCP tool messages', async () => {
    const user = userEvent.setup();

    getProjectStateMock.mockResolvedValue({
      selectedConversationId: 'conv-mcp',
      selectedConversationIdByProject: {
        [normalizeProjectPath(PROJECT_PATH)]: 'conv-mcp',
      },
      conversations: [
        {
          id: 'conv-mcp',
          title: 'MCP Conversation',
          projectPath: PROJECT_PATH,
          createdAt: 1,
          updatedAt: 2,
          previewHistory: [],
          currentPreviewIndex: 0,
          messages: [
            {
              id: 'msg-user-mcp',
              role: 'user',
              text: 'search MCP code',
              createdAt: 1,
            },
            {
              id: 'msg-tool-mcp',
              role: 'tool',
              text: JSON.stringify({
                status: 'ok',
                path: 'src/utils/mcpClient.ts',
                matches: 3,
              }),
              toolCallId: 'call-mcp',
              toolName: 'mcp_filesystem__search_code',
              toolArgs: { query: 'mcp', path: 'src' },
              createdAt: 2,
            },
          ],
        },
      ],
    });

    renderAgentPanel(PROJECT_PATH);

    await screen.findByTestId('agent-nav-sidebar');
    const sessionColumn = screen.getByTestId('agent-session-column');
    await within(sessionColumn).findByText('search_code');
    expect(within(sessionColumn).getByText('MCP')).toBeInTheDocument();
    expect(within(sessionColumn).getByText('filesystem')).toBeInTheDocument();
    expect(screen.queryByText('Raw Output')).not.toBeInTheDocument();

    const mcpToggleButton = within(sessionColumn).getByText('search_code').closest('button');
    expect(mcpToggleButton).not.toBeNull();
    await user.click(mcpToggleButton!);

    expect(screen.getByText('Raw Output')).toBeInTheDocument();
  });
});
