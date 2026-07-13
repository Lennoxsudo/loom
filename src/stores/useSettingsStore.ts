/**
 * Settings Store
 * 
 * 使用 Zustand 管理设置状态，支持细粒度订阅
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { logError } from '../utils/errorHandling';
import { normalizeProjectPath } from '../shared/lib/projectPath';
import type {
  CursorStyle,
  CursorBlinking,
  StartupBehavior,
  FileSortBy,
  StreamSpeed,
  KeyBindings,
  SettingsState,
  Language,
  AgentCommandExecutionMode,
  AgentAccessMode,
  ToolCallDelay,
  ThemeMode,
  RenderWhitespaceMode,
  ReasoningEffort,
  AgentRuntimeMode,
  RecentWorkspace,
} from '../types/settings';
import {
  DEFAULT_KEY_BINDINGS,
  migrateLegacyExecutionMode,
} from '../types/settings';
import { normalizeHexColor } from '../utils/lineHighlightColor';

interface SettingsActions {
  setLoading: (loading: boolean) => void;
  loadSettings: (settings: Partial<SettingsState>) => void;
  updateTabSize: (size: 2 | 4 | 8) => Promise<void>;
  updateAutoSaveDelay: (delay: 0 | 1000 | 3000 | 5000 | 10000) => Promise<void>;
  updateFontSize: (size: number) => Promise<void>;
  updateWordWrap: (enabled: boolean) => Promise<void>;
  updateLineNumbers: (enabled: boolean) => Promise<void>;
  updateMinimap: (enabled: boolean) => Promise<void>;
  updateCursorStyle: (style: CursorStyle) => Promise<void>;
  updateCursorBlinking: (blinking: CursorBlinking) => Promise<void>;
  updateFormatOnSave: (enabled: boolean) => Promise<void>;
  updateStartupBehavior: (behavior: StartupBehavior) => Promise<void>;
  updateExcludePatterns: (patterns: string[]) => Promise<void>;
  updateFileSortBy: (sortBy: FileSortBy) => Promise<void>;
  updateFoldersFirst: (enabled: boolean) => Promise<void>;
  updateLanguage: (language: Language) => Promise<void>;
  updateThemeMode: (themeMode: ThemeMode) => Promise<void>;
  updateRenderWhitespace: (mode: RenderWhitespaceMode) => Promise<void>;
  updateCurrentLineHighlight: (enabled: boolean) => Promise<void>;
  updateCurrentLineHighlightColor: (color: string | null) => void;
  updateBracketPairColorization: (enabled: boolean) => Promise<void>;
  updateCompactFolders: (enabled: boolean) => Promise<void>;
  updateAutoRevealCurrentFile: (enabled: boolean) => Promise<void>;
  updateAgentAccessMode: (mode: AgentAccessMode) => Promise<void>;
  updateToolCallDelay: (delay: ToolCallDelay) => Promise<void>;
  updateStreamSpeed: (speed: StreamSpeed) => Promise<void>;
  updateThinkingBlockAutoExpand: (enabled: boolean) => Promise<void>;
  updateEnableSubagents: (enabled: boolean) => Promise<void>;
  updateEnableCodeGraph: (enabled: boolean) => Promise<void>;
  updateGraphAutoIndexOnOpen: (enabled: boolean) => Promise<void>;
  updateGraphAutoIndexMaxFiles: (maxFiles: number) => Promise<void>;
  updateReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
  updateAgentRuntimeMode: (mode: AgentRuntimeMode) => Promise<void>;
  updateSpendCap: (enable: boolean, cap: number) => Promise<void>;
  updateUsageTracking: (enabled: boolean) => Promise<void>;
  touchRecentWorkspace: (path: string, name: string) => Promise<void>;
  removeRecentWorkspace: (path: string) => Promise<void>;
  initializeSettings: () => Promise<void>;
}

const DEFAULT_STATE: Omit<SettingsState, 'loading'> = {
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
  excludePatterns: ['node_modules', '.git', '.DS_Store', '*.log'],
  fileSortBy: 'name',
  foldersFirst: true,
  streamSpeed: 'fast',
  keyBindings: DEFAULT_KEY_BINDINGS,
  agentAccessMode: 'auto',
  toolCallDelay: 2000,
  thinkingBlockAutoExpand: true,
  enableSubagents: true,
  subagentModelAliases: {
    sonnet: 'inherit',
    opus: 'inherit',
    haiku: 'inherit',
    fable: 'inherit',
  } as Record<string, string>,
  reasoningEffort: 'medium' as ReasoningEffort,
  agentRuntimeMode: 'local' as AgentRuntimeMode,
  recentWorkspaces: [] as RecentWorkspace[],
  enableCodeGraph: true,
  graphAutoIndexOnOpen: true,
  graphAutoIndexMaxFiles: 50_000,
  enableSpendCap: false,
  spendCap: 0,
  enableUsageTracking: true,
  language: 'zh-CN',
  themeMode: 'system',
  renderWhitespace: 'none',
  currentLineHighlight: true,
  currentLineHighlightColor: null,
  bracketPairColorization: true,
  compactFolders: true,
  autoRevealCurrentFile: true,
};

function serializeSettings(state: Omit<SettingsState, 'loading'>): string {
  return JSON.stringify({
    tabSize: state.tabSize,
    autoSaveDelay: state.autoSaveDelay,
    fontSize: state.fontSize,
    wordWrap: state.wordWrap,
    lineNumbers: state.lineNumbers,
    minimap: state.minimap,
    cursorStyle: state.cursorStyle,
    cursorBlinking: state.cursorBlinking,
    formatOnSave: state.formatOnSave,
    startupBehavior: state.startupBehavior,
    excludePatterns: state.excludePatterns,
    fileSortBy: state.fileSortBy,
    foldersFirst: state.foldersFirst,
    streamSpeed: state.streamSpeed,
    keyBindings: state.keyBindings,
    agentAccessMode: state.agentAccessMode,
    toolCallDelay: state.toolCallDelay,
    thinkingBlockAutoExpand: state.thinkingBlockAutoExpand,
    enableSubagents: state.enableSubagents,
    subagentModelAliases: state.subagentModelAliases,
    reasoningEffort: state.reasoningEffort,
    agentRuntimeMode: state.agentRuntimeMode,
    recentWorkspaces: state.recentWorkspaces,
    enableCodeGraph: state.enableCodeGraph,
    graphAutoIndexOnOpen: state.graphAutoIndexOnOpen,
    graphAutoIndexMaxFiles: state.graphAutoIndexMaxFiles,
    enableSpendCap: state.enableSpendCap,
    spendCap: state.spendCap,
    enableUsageTracking: state.enableUsageTracking,
    language: state.language,
    themeMode: state.themeMode,
    renderWhitespace: state.renderWhitespace,
    currentLineHighlight: state.currentLineHighlight,
    currentLineHighlightColor: state.currentLineHighlightColor,
    bracketPairColorization: state.bracketPairColorization,
    compactFolders: state.compactFolders,
    autoRevealCurrentFile: state.autoRevealCurrentFile,
  });
}

function parseLoadedSettings(raw: unknown): Partial<Omit<SettingsState, 'loading'>> {
  if (!raw || typeof raw !== 'object') return {};

  const settings = raw as Record<string, unknown>;
  const result: Partial<Omit<SettingsState, 'loading'>> = {};

  if ([2, 4, 8].includes(settings.tabSize as number)) {
    result.tabSize = settings.tabSize as 2 | 4 | 8;
  }

  if ([0, 1000, 3000, 5000, 10000].includes(settings.autoSaveDelay as number)) {
    result.autoSaveDelay = settings.autoSaveDelay as 0 | 1000 | 3000 | 5000 | 10000;
  }

  if (typeof settings.fontSize === 'number' && settings.fontSize >= 10 && settings.fontSize <= 24) {
    result.fontSize = settings.fontSize;
  }

  if (typeof settings.wordWrap === 'boolean') result.wordWrap = settings.wordWrap;
  if (typeof settings.lineNumbers === 'boolean') result.lineNumbers = settings.lineNumbers;
  if (typeof settings.minimap === 'boolean') result.minimap = settings.minimap;
  if (typeof settings.formatOnSave === 'boolean') result.formatOnSave = settings.formatOnSave;
  if (typeof settings.foldersFirst === 'boolean') result.foldersFirst = settings.foldersFirst;

  if (['line', 'block', 'underline'].includes(settings.cursorStyle as string)) {
    result.cursorStyle = settings.cursorStyle as CursorStyle;
  }

  if (['blink', 'smooth', 'phase', 'solid'].includes(settings.cursorBlinking as string)) {
    result.cursorBlinking = settings.cursorBlinking as CursorBlinking;
  }

  if (['lastProject', 'welcome', 'empty'].includes(settings.startupBehavior as string)) {
    result.startupBehavior = settings.startupBehavior as StartupBehavior;
  }

  if (['name', 'type', 'modified'].includes(settings.fileSortBy as string)) {
    result.fileSortBy = settings.fileSortBy as FileSortBy;
  }

  if (['fast', 'normal', 'slow'].includes(settings.streamSpeed as string)) {
    result.streamSpeed = settings.streamSpeed as StreamSpeed;
  }

  if (Array.isArray(settings.excludePatterns)) {
    result.excludePatterns = settings.excludePatterns as string[];
  }

  if (settings.keyBindings && typeof settings.keyBindings === 'object') {
    result.keyBindings = { ...DEFAULT_KEY_BINDINGS, ...(settings.keyBindings as KeyBindings) };
  }

  if (['read_only', 'auto', 'full_access'].includes(settings.agentAccessMode as string)) {
    result.agentAccessMode = settings.agentAccessMode as AgentAccessMode;
  }

  if (['deny', 'request', 'always'].includes(settings.agentCommandExecutionMode as string)
    || ['deny', 'request', 'always'].includes(settings.chatToolApprovalMode as string)) {
    // Read legacy fields for migration (not stored in result since they're removed from SettingsState)
    const legacyMode = (settings.agentCommandExecutionMode ?? settings.chatToolApprovalMode) as string | undefined;
    if (!result.agentAccessMode && legacyMode && ['deny', 'request', 'always'].includes(legacyMode)) {
      result.agentAccessMode = migrateLegacyExecutionMode(legacyMode as AgentCommandExecutionMode);
    }
  }

  if ([0, 500, 1000, 2000, 3000, 5000].includes(settings.toolCallDelay as number)) {
    result.toolCallDelay = settings.toolCallDelay as ToolCallDelay;
  }

  if (typeof settings.thinkingBlockAutoExpand === 'boolean') {
    result.thinkingBlockAutoExpand = settings.thinkingBlockAutoExpand;
  }

  if (typeof settings.enableSubagents === 'boolean') {
    result.enableSubagents = settings.enableSubagents;
  }

  if (typeof settings.enableCodeGraph === 'boolean') {
    result.enableCodeGraph = settings.enableCodeGraph;
  }

  if (typeof settings.graphAutoIndexOnOpen === 'boolean') {
    result.graphAutoIndexOnOpen = settings.graphAutoIndexOnOpen;
  }

  if (typeof settings.graphAutoIndexMaxFiles === 'number' && Number.isFinite(settings.graphAutoIndexMaxFiles)) {
    result.graphAutoIndexMaxFiles = Math.max(0, Math.floor(settings.graphAutoIndexMaxFiles));
  }

  if (typeof settings.enableSpendCap === 'boolean') {
    result.enableSpendCap = settings.enableSpendCap;
  }

  if (typeof settings.spendCap === 'number' && Number.isFinite(settings.spendCap) && settings.spendCap >= 0) {
    result.spendCap = settings.spendCap;
  }

  if (typeof settings.enableUsageTracking === 'boolean') {
    result.enableUsageTracking = settings.enableUsageTracking;
  }

  if (settings.subagentModelAliases && typeof settings.subagentModelAliases === 'object') {
    result.subagentModelAliases = settings.subagentModelAliases as Record<string, string>;
  }

  if (['low', 'medium', 'high'].includes(settings.reasoningEffort as string)) {
    result.reasoningEffort = settings.reasoningEffort as ReasoningEffort;
  }

  if (['local', 'cloud'].includes(settings.agentRuntimeMode as string)) {
    result.agentRuntimeMode = settings.agentRuntimeMode as AgentRuntimeMode;
  }

  if (Array.isArray(settings.recentWorkspaces)) {
    result.recentWorkspaces = settings.recentWorkspaces
      .filter(
        (item): item is RecentWorkspace =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as RecentWorkspace).path === 'string' &&
          typeof (item as RecentWorkspace).name === 'string'
      )
      .slice(0, 12);
  }

  if (['zh-CN', 'en-US'].includes(settings.language as string)) {
    result.language = settings.language as Language;
  }

  if (['system', 'dark', 'light'].includes(settings.themeMode as string)) {
    result.themeMode = settings.themeMode as ThemeMode;
  }

  if (['none', 'boundary', 'selection', 'all'].includes(settings.renderWhitespace as string)) {
    result.renderWhitespace = settings.renderWhitespace as RenderWhitespaceMode;
  }

  if (typeof settings.currentLineHighlight === 'boolean') {
    result.currentLineHighlight = settings.currentLineHighlight;
  }

  if (settings.currentLineHighlightColor === null) {
    result.currentLineHighlightColor = null;
  } else if (typeof settings.currentLineHighlightColor === 'string') {
    const normalized = normalizeHexColor(settings.currentLineHighlightColor);
    if (normalized) {
      result.currentLineHighlightColor = normalized;
    }
  }

  if (typeof settings.bracketPairColorization === 'boolean') {
    result.bracketPairColorization = settings.bracketPairColorization;
  }

  if (typeof settings.compactFolders === 'boolean') {
    result.compactFolders = settings.compactFolders;
  }

  if (typeof settings.autoRevealCurrentFile === 'boolean') {
    result.autoRevealCurrentFile = settings.autoRevealCurrentFile;
  }

  return result;
}

async function saveSettings(state: Omit<SettingsState, 'loading'>): Promise<void> {
  if (!isTauri()) return;
  try {
    const settingsStr = serializeSettings(state);
    await invoke('save_editor_settings', { settings: settingsStr });
  } catch (error) {
    logError(error, '保存编辑器设置');
    throw error;
  }
}

const LINE_HIGHLIGHT_COLOR_SAVE_DELAY_MS = 400;
let lineHighlightColorSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleLineHighlightColorSave(
  get: () => SettingsState & SettingsActions,
  immediate = false
): void {
  if (lineHighlightColorSaveTimer) {
    clearTimeout(lineHighlightColorSaveTimer);
    lineHighlightColorSaveTimer = null;
  }

  const runSave = () => {
    lineHighlightColorSaveTimer = null;
    const state = get();
    void saveSettings({ ...DEFAULT_STATE, ...state }).catch((error) => {
      logError(error, '保存当前行高亮颜色');
    });
  };

  if (immediate) {
    runSave();
    return;
  }

  lineHighlightColorSaveTimer = setTimeout(runSave, LINE_HIGHLIGHT_COLOR_SAVE_DELAY_MS);
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  devtools(
    (set, get) => ({
      ...DEFAULT_STATE,
      loading: true,

      setLoading: (loading) => set({ loading }),

      loadSettings: (settings) => set({ ...settings, loading: false }),

      updateTabSize: async (tabSize) => {
        set({ tabSize });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateAutoSaveDelay: async (autoSaveDelay) => {
        set({ autoSaveDelay });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateFontSize: async (fontSize) => {
        const clampedSize = Math.min(24, Math.max(10, fontSize));
        set({ fontSize: clampedSize });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateWordWrap: async (wordWrap) => {
        set({ wordWrap });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateLineNumbers: async (lineNumbers) => {
        set({ lineNumbers });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateMinimap: async (minimap) => {
        set({ minimap });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateCursorStyle: async (cursorStyle) => {
        set({ cursorStyle });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateCursorBlinking: async (cursorBlinking) => {
        set({ cursorBlinking });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateFormatOnSave: async (formatOnSave) => {
        set({ formatOnSave });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateStartupBehavior: async (startupBehavior) => {
        set({ startupBehavior });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateExcludePatterns: async (excludePatterns) => {
        set({ excludePatterns });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateFileSortBy: async (fileSortBy) => {
        set({ fileSortBy });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateFoldersFirst: async (foldersFirst) => {
        set({ foldersFirst });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateLanguage: async (language) => {
        set({ language });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateThemeMode: async (themeMode) => {
        set({ themeMode });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateRenderWhitespace: async (renderWhitespace) => {
        set({ renderWhitespace });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateCurrentLineHighlight: async (currentLineHighlight) => {
        set({ currentLineHighlight });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateCurrentLineHighlightColor: (currentLineHighlightColor) => {
        set({ currentLineHighlightColor });
        scheduleLineHighlightColorSave(get, currentLineHighlightColor === null);
      },

      updateBracketPairColorization: async (bracketPairColorization) => {
        set({ bracketPairColorization });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateCompactFolders: async (compactFolders) => {
        set({ compactFolders });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateAutoRevealCurrentFile: async (autoRevealCurrentFile) => {
        set({ autoRevealCurrentFile });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateAgentAccessMode: async (agentAccessMode) => {
        set({ agentAccessMode });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateToolCallDelay: async (toolCallDelay) => {
        set({ toolCallDelay });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateStreamSpeed: async (streamSpeed) => {
        set({ streamSpeed });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateThinkingBlockAutoExpand: async (thinkingBlockAutoExpand) => {
        set({ thinkingBlockAutoExpand });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateEnableSubagents: async (enableSubagents) => {
        set({ enableSubagents });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateEnableCodeGraph: async (enableCodeGraph) => {
        set({ enableCodeGraph });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateGraphAutoIndexOnOpen: async (graphAutoIndexOnOpen) => {
        set({ graphAutoIndexOnOpen });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateGraphAutoIndexMaxFiles: async (graphAutoIndexMaxFiles) => {
        set({ graphAutoIndexMaxFiles: Math.max(0, Math.floor(graphAutoIndexMaxFiles)) });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateReasoningEffort: async (reasoningEffort) => {
        set({ reasoningEffort });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateAgentRuntimeMode: async (agentRuntimeMode) => {
        set({ agentRuntimeMode });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateSpendCap: async (enable, cap) => {
        set({ enableSpendCap: enable, spendCap: Math.max(0, cap || 0) });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      updateUsageTracking: async (enabled) => {
        set({ enableUsageTracking: enabled });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      touchRecentWorkspace: async (path, name) => {
        const trimmedPath = path.trim();
        const trimmedName = name.trim() || trimmedPath.split(/[\\/]/).pop() || trimmedPath;
        if (!trimmedPath) return;
        const now = new Date().toISOString();
        const normalizedNew = normalizeProjectPath(trimmedPath);
        const current = get().recentWorkspaces;
        const existingIndex = current.findIndex(
          (workspace) => normalizeProjectPath(workspace.path) === normalizedNew
        );

        let next: RecentWorkspace[];
        if (existingIndex >= 0) {
          next = current.map((workspace, index) =>
            index === existingIndex
              ? { path: trimmedPath, name: trimmedName, lastOpenedAt: now }
              : workspace
          );
        } else {
          next = [
            ...current,
            { path: trimmedPath, name: trimmedName, lastOpenedAt: now },
          ].slice(-12);
        }

        set({ recentWorkspaces: next });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      removeRecentWorkspace: async (path) => {
        const trimmedPath = path.trim();
        if (!trimmedPath) return;
        const normalizedTarget = normalizeProjectPath(trimmedPath);
        const current = get().recentWorkspaces;
        const next = current.filter(
          (workspace) => normalizeProjectPath(workspace.path) !== normalizedTarget
        );
        if (next.length === current.length) return;
        set({ recentWorkspaces: next });
        const state = get();
        await saveSettings({ ...DEFAULT_STATE, ...state });
      },

      initializeSettings: async () => {
        if (!isTauri()) {
          set({ loading: false });
          return;
        }
        try {
          // 超时保护：如果 invoke 挂起，5 秒后使用默认设置启动应用
          const settingsStr = await Promise.race([
            invoke<string>('load_editor_settings'),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('load_editor_settings 超时')), 5000)
            ),
          ]);
          if (settingsStr) {
            const rawSettings = JSON.parse(settingsStr);
            const parsed = parseLoadedSettings(rawSettings);
            set({
              ...parsed,
              loading: false,
            });
          } else {
            set({ loading: false });
          }
        } catch (error) {
          logError(error, '加载编辑器设置');
          set({ loading: false });
        }
      },
    }),
    {
      name: 'SettingsStore',
    }
  )
);

// 细粒度选择器 hooks，避免不必要的重渲染
export const useTabSize = () => useSettingsStore((state) => state.tabSize);
export const useAutoSaveDelay = () => useSettingsStore((state) => state.autoSaveDelay);
export const useFontSize = () => useSettingsStore((state) => state.fontSize);
export const useWordWrap = () => useSettingsStore((state) => state.wordWrap);
export const useLineNumbers = () => useSettingsStore((state) => state.lineNumbers);
export const useMinimap = () => useSettingsStore((state) => state.minimap);
export const useCursorStyle = () => useSettingsStore((state) => state.cursorStyle);
export const useCursorBlinking = () => useSettingsStore((state) => state.cursorBlinking);
export const useFormatOnSave = () => useSettingsStore((state) => state.formatOnSave);
export const useStartupBehavior = () => useSettingsStore((state) => state.startupBehavior);
export const useExcludePatterns = () => useSettingsStore((state) => state.excludePatterns);
export const useFileSortBy = () => useSettingsStore((state) => state.fileSortBy);
export const useFoldersFirst = () => useSettingsStore((state) => state.foldersFirst);
export const useStreamSpeed = () => useSettingsStore((state) => state.streamSpeed);
export const useUpdateStreamSpeed = () => useSettingsStore((state) => state.updateStreamSpeed);
export const useKeyBindings = () => useSettingsStore((state) => state.keyBindings);
export const useLanguage = () => useSettingsStore((state) => state.language);
export const useThemeMode = () => useSettingsStore((state) => state.themeMode);
export const useRenderWhitespace = () => useSettingsStore((state) => state.renderWhitespace);
export const useCurrentLineHighlight = () => useSettingsStore((state) => state.currentLineHighlight);
export const useCurrentLineHighlightColor = () => useSettingsStore((state) => state.currentLineHighlightColor);
export const useBracketPairColorization = () => useSettingsStore((state) => state.bracketPairColorization);
export const useCompactFolders = () => useSettingsStore((state) => state.compactFolders);
export const useAutoRevealCurrentFile = () => useSettingsStore((state) => state.autoRevealCurrentFile);
export const useAgentAccessMode = () => useSettingsStore((state) => state.agentAccessMode);
export const useToolCallDelay = () => useSettingsStore((state) => state.toolCallDelay);
export const useThinkingBlockAutoExpand = () => useSettingsStore((state) => state.thinkingBlockAutoExpand);
export const useEnableSubagents = () => useSettingsStore((state) => state.enableSubagents);
export const useReasoningEffort = () => useSettingsStore((state) => state.reasoningEffort);
export const useAgentRuntimeMode = () => useSettingsStore((state) => state.agentRuntimeMode);
export const useRecentWorkspaces = () => useSettingsStore((state) => state.recentWorkspaces);
export const useSettingsLoading = () => useSettingsStore((state) => state.loading);

// 导出单独的 action hooks，避免创建新对象导致的无限循环
export const useUpdateTabSize = () => useSettingsStore((state) => state.updateTabSize);
export const useUpdateAutoSaveDelay = () => useSettingsStore((state) => state.updateAutoSaveDelay);
export const useUpdateFontSize = () => useSettingsStore((state) => state.updateFontSize);
export const useUpdateWordWrap = () => useSettingsStore((state) => state.updateWordWrap);
export const useUpdateLineNumbers = () => useSettingsStore((state) => state.updateLineNumbers);
export const useUpdateMinimap = () => useSettingsStore((state) => state.updateMinimap);
export const useUpdateCursorStyle = () => useSettingsStore((state) => state.updateCursorStyle);
export const useUpdateCursorBlinking = () => useSettingsStore((state) => state.updateCursorBlinking);
export const useUpdateFormatOnSave = () => useSettingsStore((state) => state.updateFormatOnSave);
export const useUpdateStartupBehavior = () => useSettingsStore((state) => state.updateStartupBehavior);
export const useUpdateExcludePatterns = () => useSettingsStore((state) => state.updateExcludePatterns);
export const useUpdateFileSortBy = () => useSettingsStore((state) => state.updateFileSortBy);
export const useUpdateFoldersFirst = () => useSettingsStore((state) => state.updateFoldersFirst);
export const useUpdateLanguage = () => useSettingsStore((state) => state.updateLanguage);
export const useUpdateThemeMode = () => useSettingsStore((state) => state.updateThemeMode);
export const useUpdateRenderWhitespace = () => useSettingsStore((state) => state.updateRenderWhitespace);
export const useUpdateCurrentLineHighlight = () => useSettingsStore((state) => state.updateCurrentLineHighlight);
export const useUpdateCurrentLineHighlightColor = () =>
  useSettingsStore((state) => state.updateCurrentLineHighlightColor);
export const useUpdateBracketPairColorization = () => useSettingsStore((state) => state.updateBracketPairColorization);
export const useUpdateCompactFolders = () => useSettingsStore((state) => state.updateCompactFolders);
export const useUpdateAutoRevealCurrentFile = () => useSettingsStore((state) => state.updateAutoRevealCurrentFile);
export const useUpdateAgentAccessMode = () => useSettingsStore((state) => state.updateAgentAccessMode);
export const useUpdateToolCallDelay = () => useSettingsStore((state) => state.updateToolCallDelay);
export const useUpdateThinkingBlockAutoExpand = () => useSettingsStore((state) => state.updateThinkingBlockAutoExpand);
export const useUpdateEnableSubagents = () => useSettingsStore((state) => state.updateEnableSubagents);
export const useEnableCodeGraph = () => useSettingsStore((state) => state.enableCodeGraph);
export const useGraphAutoIndexOnOpen = () => useSettingsStore((state) => state.graphAutoIndexOnOpen);
export const useGraphAutoIndexMaxFiles = () => useSettingsStore((state) => state.graphAutoIndexMaxFiles);
export const useUpdateEnableCodeGraph = () => useSettingsStore((state) => state.updateEnableCodeGraph);
export const useUpdateGraphAutoIndexOnOpen = () => useSettingsStore((state) => state.updateGraphAutoIndexOnOpen);
export const useUpdateGraphAutoIndexMaxFiles = () => useSettingsStore((state) => state.updateGraphAutoIndexMaxFiles);
export const useUpdateReasoningEffort = () => useSettingsStore((state) => state.updateReasoningEffort);
export const useUpdateAgentRuntimeMode = () => useSettingsStore((state) => state.updateAgentRuntimeMode);
export const useEnableSpendCap = () => useSettingsStore((state) => state.enableSpendCap);
export const useSpendCap = () => useSettingsStore((state) => state.spendCap);
export const useUpdateSpendCap = () => useSettingsStore((state) => state.updateSpendCap);
export const useEnableUsageTracking = () => useSettingsStore((state) => state.enableUsageTracking);
export const useUpdateUsageTracking = () => useSettingsStore((state) => state.updateUsageTracking);
export const useTouchRecentWorkspace = () => useSettingsStore((state) => state.touchRecentWorkspace);
export const useRemoveRecentWorkspace = () => useSettingsStore((state) => state.removeRecentWorkspace);
export const useInitializeSettings = () => useSettingsStore((state) => state.initializeSettings);
