/**
 * Unit tests for SettingsView Rules tab (RulesContent component)
 *
 * Tests rendering of the rules tab, Chat Rules and Rules Templates sections,
 * add/edit/delete flows, and input validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RuleItem } from '../../types/rules';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: vi.fn(() => false),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// Mock rulesPersistence
vi.mock('../../utils/rulesPersistence', () => ({
  loadRulesConfig: vi.fn(() => Promise.resolve({ chatRules: [], rulesTemplates: [] })),
  saveRulesConfig: vi.fn(() => Promise.resolve()),
}));

// Mock skills utilities
vi.mock('../../utils/skills', () => ({
  getSkillsList: vi.fn(() => Promise.resolve({ global: [], project: [] })),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  clearSkillsCache: vi.fn(),
  getGlobalSkillsDir: vi.fn(() => Promise.resolve('')),
}));

// Mock mcpClient
vi.mock('../../utils/mcpClient', () => ({
  mcpClient: {
    getServerStatuses: vi.fn(() => Promise.resolve([])),
    listTools: vi.fn(() => Promise.resolve([])),
  },
}));

// Mock stores
vi.mock('../../stores', () => {
  const mockFn = (val: any) => vi.fn((selector?: any) => selector ? selector(val) : val);
  return {
    useFileStore: mockFn({ projectPath: '' }),
    useTabSize: mockFn(4),
    useAutoSaveDelay: mockFn(3000),
    useFontSize: mockFn(14),
    useWordWrap: mockFn(false),
    useLineNumbers: mockFn(true),
    useMinimap: mockFn(true),
    useCursorStyle: mockFn('line'),
    useCursorBlinking: mockFn('blink'),
    useFormatOnSave: mockFn(false),
    useStartupBehavior: mockFn('welcome'),
    useExcludePatterns: mockFn([]),
    useFileSortBy: mockFn('name'),
    useFoldersFirst: mockFn(true),
    useThemeMode: mockFn('system'),
    useRenderWhitespace: mockFn('none'),
    useCurrentLineHighlight: mockFn(true),
    useCurrentLineHighlightColor: mockFn(null),
    useBracketPairColorization: mockFn(true),
    useCompactFolders: mockFn(true),
    useAutoRevealCurrentFile: mockFn(true),
    useSettingsLoading: mockFn(false),
    useLanguage: mockFn('en-US'),
    useUpdateTabSize: vi.fn(),
    useUpdateAutoSaveDelay: vi.fn(),
    useUpdateFontSize: vi.fn(),
    useUpdateWordWrap: vi.fn(),
    useUpdateLineNumbers: vi.fn(),
    useUpdateMinimap: vi.fn(),
    useUpdateCursorStyle: vi.fn(),
    useUpdateCursorBlinking: vi.fn(),
    useUpdateFormatOnSave: vi.fn(),
    useUpdateStartupBehavior: vi.fn(),
    useUpdateExcludePatterns: vi.fn(),
    useUpdateFileSortBy: vi.fn(),
    useUpdateFoldersFirst: vi.fn(),
    useUpdateThemeMode: vi.fn(),
    useUpdateRenderWhitespace: vi.fn(),
    useUpdateCurrentLineHighlight: vi.fn(),
    useUpdateCurrentLineHighlightColor: vi.fn(),
    useUpdateBracketPairColorization: vi.fn(),
    useUpdateCompactFolders: vi.fn(),
    useUpdateAutoRevealCurrentFile: vi.fn(),
    useUpdateLanguage: vi.fn(),
    useAgentAccessMode: mockFn('auto'),
    useUpdateAgentAccessMode: vi.fn(),
    useToolCallDelay: mockFn(500),
    useUpdateToolCallDelay: vi.fn(),
    useThinkingBlockAutoExpand: mockFn(false),
    useUpdateThinkingBlockAutoExpand: vi.fn(),
  };
});

vi.mock('../../stores/useToolStore', () => ({
  useToolStore: vi.fn((selector: any) => selector({ tools: [], setTools: vi.fn() })),
}));

// Mock contexts
vi.mock('../../contexts/SettingsContext', () => ({
  useSettings: vi.fn(() => ({
    tabSize: 4,
    autoSaveDelay: 3000,
    fontSize: 14,
    wordWrap: false,
    lineNumbers: true,
    minimap: true,
    cursorStyle: 'line',
    cursorBlinking: 'blink',
    formatOnSave: false,
    startupBehavior: 'welcome',
    excludePatterns: [],
    fileSortBy: 'name',
    foldersFirst: true,
    language: 'en-US',
    loading: false,
    updateTabSize: vi.fn(),
    updateAutoSaveDelay: vi.fn(),
    updateFontSize: vi.fn(),
    updateWordWrap: vi.fn(),
    updateLineNumbers: vi.fn(),
    updateMinimap: vi.fn(),
    updateCursorStyle: vi.fn(),
    updateCursorBlinking: vi.fn(),
    updateFormatOnSave: vi.fn(),
    updateStartupBehavior: vi.fn(),
    updateExcludePatterns: vi.fn(),
    updateFileSortBy: vi.fn(),
    updateFoldersFirst: vi.fn(),
    updateLanguage: vi.fn(),
  })),
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: vi.fn(() => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  })),
}));

// Mock notification utils
vi.mock('../../utils/notification', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal('crypto', { randomUUID: () => `test-uuid-${++uuidCounter}` });

import { useRulesStore } from '../../stores/useRulesStore';
import { saveRulesConfig } from '../../utils/rulesPersistence';
import { I18nProvider } from '../../i18n';
import SettingsView from '../SettingsView';

const mockedSave = vi.mocked(saveRulesConfig);

function renderWithProviders() {
  return render(
    <I18nProvider defaultLocale="en-US">
      <SettingsView />
    </I18nProvider>
  );
}

/** Click the Rules tab in the sidebar */
async function clickRulesTab(user: ReturnType<typeof userEvent.setup>) {
  const sidebar = document.querySelector('[class*="sidebar"]') as HTMLElement;
  const rulesTab = within(sidebar).getByText('Rules');
  await user.click(rulesTab);
}

function seedRules(chatRules: RuleItem[] = [], rulesTemplates: RuleItem[] = []) {
  useRulesStore.setState({ chatRules, rulesTemplates, loaded: true });
}

function resetStore() {
  useRulesStore.setState({ chatRules: [], rulesTemplates: [], loaded: true });
}

const sampleRule: RuleItem = {
  id: 'r1',
  name: 'Test Rule',
  content: 'Test rule content here',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const sampleTemplate: RuleItem = {
  id: 't1',
  name: 'Test Template',
  content: 'Template content here',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('SettingsView Rules Tab', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    uuidCounter = 0;
    resetStore();
    mockedSave.mockResolvedValue(undefined);
  });

  it('should show Rules tab in sidebar', () => {
    renderWithProviders();
    const sidebar = document.querySelector('[class*="sidebar"]') as HTMLElement;
    expect(within(sidebar).getByText('Rules')).toBeInTheDocument();
  });

  it('should render RulesContent when rules tab is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    expect(screen.getByText('Rules Configuration')).toBeInTheDocument();
    expect(screen.getByText('Chat Rules')).toBeInTheDocument();
    expect(screen.getByText('Rules Templates')).toBeInTheDocument();
  });

  it('should show empty state messages when no rules exist', async () => {
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    expect(screen.getByText('No chat rules yet')).toBeInTheDocument();
    expect(screen.getByText('No rules templates yet')).toBeInTheDocument();
  });

  it('should display existing chat rules', async () => {
    seedRules([sampleRule]);
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    expect(screen.getByText('Test Rule')).toBeInTheDocument();
  });

  it('should display existing templates', async () => {
    seedRules([], [sampleTemplate]);
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    expect(screen.getByText('Test Template')).toBeInTheDocument();
  });

  it('should show add form when New Rule button is clicked for chat rules', async () => {
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    // First "+ New Rule" button is for Chat Rules section
    const addButtons = screen.getAllByText('+ New Rule');
    await user.click(addButtons[0]);

    // After clicking, the form should appear (first set of inputs is for Chat Rules)
    const nameInputs = screen.getAllByPlaceholderText('Enter rule name');
    expect(nameInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('should validate empty name on add', async () => {
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    const addButtons = screen.getAllByText('+ New Rule');
    await user.click(addButtons[0]);

    // Type content in the first textarea (Chat Rules form)
    const contentInputs = screen.getAllByPlaceholderText('Enter rule content...');
    await user.type(contentInputs[0], 'Some content');

    // Click the first Save button
    const saveButtons = screen.getAllByText('Save');
    await user.click(saveButtons[0]);

    expect(screen.getByText('Rule name is required')).toBeInTheDocument();
  });

  it('should validate empty content on add', async () => {
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    const addButtons = screen.getAllByText('+ New Rule');
    await user.click(addButtons[0]);

    const nameInputs = screen.getAllByPlaceholderText('Enter rule name');
    await user.type(nameInputs[0], 'My Rule');

    const saveButtons = screen.getAllByText('Save');
    await user.click(saveButtons[0]);

    expect(screen.getByText('Rule content is required')).toBeInTheDocument();
  });

  it('should add a new chat rule successfully', async () => {
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    const addButtons = screen.getAllByText('+ New Rule');
    await user.click(addButtons[0]);

    const nameInputs = screen.getAllByPlaceholderText('Enter rule name');
    const contentInputs = screen.getAllByPlaceholderText('Enter rule content...');
    await user.type(nameInputs[0], 'New Rule');
    await user.type(contentInputs[0], 'New rule content');

    const saveButtons = screen.getAllByText('Save');
    await user.click(saveButtons[0]);

    expect(screen.getByText('New Rule')).toBeInTheDocument();
    expect(mockedSave).toHaveBeenCalled();
  });

  it('should expand rule for editing when Edit is clicked', async () => {
    seedRules([sampleRule]);
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    const editButtons = screen.getAllByText('Edit');
    await user.click(editButtons[0]);

    expect(screen.getByDisplayValue('Test Rule')).toBeInTheDocument();
  });

  it('should show delete confirmation when Delete is clicked', async () => {
    seedRules([sampleRule]);
    const user = userEvent.setup();
    renderWithProviders();
    await clickRulesTab(user);

    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);

    expect(screen.getByText('Are you sure you want to delete this rule?')).toBeInTheDocument();
  });
});
