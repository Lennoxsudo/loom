/**
 * Application settings type definitions
 */

/**
 * Cursor display style
 */
export type CursorStyle = 'line' | 'block' | 'underline';

/**
 * Cursor blinking animation mode
 */
export type CursorBlinking = 'blink' | 'smooth' | 'phase' | 'solid';

/**
 * Application startup behavior
 */
export type StartupBehavior = 'lastProject' | 'welcome' | 'empty';

/**
 * File sorting method
 */
export type FileSortBy = 'name' | 'type' | 'modified';

/**
 * Application language
 */
export type Language = 'zh-CN' | 'en-US';

/**
 * Application theme mode
 */
export type ThemeMode = 'system' | 'dark' | 'light';

/**
 * Editor whitespace rendering mode
 */
export type RenderWhitespaceMode = 'none' | 'boundary' | 'selection' | 'all';

/**
 * Stream output speed
 */
export type StreamSpeed = 'fast' | 'normal' | 'slow';

/**
 * Reasoning effort level for agent composer UI
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Agent runtime mode (local vs cloud placeholder)
 */
export type AgentRuntimeMode = 'local' | 'cloud';

/**
 * Recently opened workspace entry for agent nav sidebar
 */
export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: string;
}

/**
 * Global command execution policy for non-CLI agents
 * @deprecated Kept for settings migration only; use AgentAccessMode at runtime.
 */
export type AgentCommandExecutionMode = 'deny' | 'request' | 'always';

/**
 * Agent access tier controlling tool approval and backend sandbox constraints.
 */
export type AgentAccessMode = 'read_only' | 'auto' | 'full_access';

/**
 * Map legacy three-state execution/approval modes to access tiers.
 * Used during settings loading to migrate old settings files.
 */
export function migrateLegacyExecutionMode(
  mode: AgentCommandExecutionMode
): AgentAccessMode {
  if (mode === 'deny') return 'read_only';
  if (mode === 'request') return 'auto';
  return 'full_access';
}

/**
 * Delay in milliseconds before sending AI request after tool execution
 */
export type ToolCallDelay = 0 | 500 | 1000 | 2000 | 3000 | 5000;

/**
 * Keyboard shortcuts configuration
 */
export interface KeyBindings {
  /** New file shortcut */
  newFile: string;
  /** Save file shortcut */
  saveFile: string;
  /** Open AI chat shortcut */
  openAIChat: string;
  /** New chat shortcut */
  newChat: string;
}

/**
 * Full settings state including all configurable options
 */
export interface SettingsState {
  /** Tab size in spaces */
  tabSize: 2 | 4 | 8;
  /** Auto-save delay in milliseconds */
  autoSaveDelay: 0 | 1000 | 3000 | 5000 | 10000;
  /** Font size in pixels */
  fontSize: number;
  /** Word wrap enabled */
  wordWrap: boolean;
  /** Show line numbers */
  lineNumbers: boolean;
  /** Show minimap */
  minimap: boolean;
  /** Cursor display style */
  cursorStyle: CursorStyle;
  /** Cursor blinking mode */
  cursorBlinking: CursorBlinking;
  /** Format on save enabled */
  formatOnSave: boolean;
  /** Startup behavior */
  startupBehavior: StartupBehavior;
  /** File exclude patterns */
  excludePatterns: string[];
  /** File sorting method */
  fileSortBy: FileSortBy;
  /** Show folders first in file tree */
  foldersFirst: boolean;
  /** Stream output speed */
  streamSpeed: StreamSpeed;
  /** Application language */
  language: Language;
  /** Application theme mode */
  themeMode: ThemeMode;
  /** Render whitespace characters */
  renderWhitespace: RenderWhitespaceMode;
  /** Highlight current line */
  currentLineHighlight: boolean;
  /** Current line highlight RGB (#RRGGBB); null uses theme default */
  currentLineHighlightColor: string | null;
  /** Enable bracket pair colorization */
  bracketPairColorization: boolean;
  /** Compact single-child directory chains in file tree */
  compactFolders: boolean;
  /** Auto reveal current file in file tree */
  autoRevealCurrentFile: boolean;
  /** Keyboard shortcuts */
  keyBindings: KeyBindings;
  /** Agent access tier (read_only / auto / full_access) */
  agentAccessMode: AgentAccessMode;
  /** Delay in milliseconds before sending AI request after tool execution */
  toolCallDelay: ToolCallDelay;
  /** Whether thinking blocks auto-expand during active streaming */
  thinkingBlockAutoExpand: boolean;
  /** Whether subagent spawn/parallel orchestration is enabled */
  enableSubagents: boolean;
  /** Model alias mapping for subagents (sonnet/haiku → actual model or inherit) */
  subagentModelAliases: Record<string, string>;
  /** Reasoning effort shown in agent composer */
  reasoningEffort: ReasoningEffort;
  /** Local vs cloud runtime mode (cloud is UI placeholder) */
  agentRuntimeMode: AgentRuntimeMode;
  /** Recently opened workspaces for agent nav */
  recentWorkspaces: RecentWorkspace[];
  /** Enable built-in code knowledge graph (CBM) tools */
  enableCodeGraph: boolean;
  /** Auto-index workspace when opened */
  graphAutoIndexOnOpen: boolean;
  /** Max files for auto-index; 0 = no limit */
  graphAutoIndexMaxFiles: number;
  /** Settings loading state */
  loading: boolean;
}

/**
 * Default key bindings configuration
 */
/**
 * Default key bindings configuration
 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  newFile: 'Ctrl+N',
  saveFile: 'Ctrl+S',
  openAIChat: 'Ctrl+K',
  newChat: 'Ctrl+Shift+N',
};
