/**
 * Chat and conversation type definitions
 */
import type { ToolCall } from './ai';
import type { PersistedSubagentRun } from './subagent';
import type { AgentAccessMode, ReasoningEffort } from './settings';
import type { AgentRoutingMode } from '../utils/agentPersistence';
import type { ChatApprovalSummary } from '../components/chat/types';

/**
 * Chat message role type
 */
type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * Preview history entry for file changes
 */
export interface PreviewHistoryEntry {
  /** File path being previewed */
  filePath: string;
  /** Current file content */
  content: string;
  /** Original content before changes */
  originalContent?: string;
  /** Modified content after changes */
  modifiedContent?: string;
  /** File language for syntax highlighting */
  language?: string;
}

/**
 * Image attachment for chat
 */
export interface ImageAttachment {
  id: string;
  type: 'image';
  path: string;
  mediaType: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  fileName?: string;
}

/**
 * Image attachment that is pending to be sent
 */
export interface PendingImageAttachment extends ImageAttachment {
  previewUrl: string;
}

/**
 * File attachment for chat messages (non-image files)
 */
export interface FileAttachment {
  /** Unique identifier */
  id: string;
  /** File path */
  path: string;
  /** File name */
  name: string;
  /** File content (injected into AI request, not displayed in bubble) */
  content: string;
  /** Language for syntax highlighting (derived from file extension) */
  language: string;
}

/**
 * Chat message in agent conversation
 */
export interface ChatMessage {
  /** Unique message identifier */
  id: string;
  /** Message sender role */
  role: ChatRole;
  /** Message text content */
  text: string;
  /** Raw standard content stream text */
  rawContent?: string;
  /** Raw separate reasoning stream text */
  rawThinking?: string;
  /** Last thinking stream chunk appended (dedupe consecutive duplicates) */
  lastThinkingChunk?: string;
  /** Whether any chunk_type === 'thinking' was received from the backend */
  receivedThinkingChunks?: boolean;
  /** Thinking content (for extended thinking models) */
  thinking?: string;
  /** Cryptographic signature for thinking block (Anthropic extended thinking) */
  thinkingSignature?: string;
  /** Whether message is still streaming */
  isStreaming?: boolean;
  /** Whether thinking is in progress */
  isThinking?: boolean;
  /** Whether tools are being processed (for showing loading animation during tool calls) */
  isProcessingTools?: boolean;
  /** Message creation timestamp */
  createdAt: number;
  /** Thinking start timestamp */
  thinkingStartedAt?: number;
  /** Thinking end timestamp */
  thinkingEndedAt?: number;
  /** Timestamp of the first non-empty content chunk */
  firstContentTime?: number;
  /** Tool calls made in this message */
  tool_calls?: ToolCall[];
  /** Tool call ID (for tool response messages) */
  tool_call_id?: string;
  /** Tool name (for tool response messages) */
  tool_name?: string;
  /** Tool arguments (for tool response messages) */
  tool_args?: Record<string, unknown>;
  /** Whether this tool result message represents an error */
  isError?: boolean;
  /** Optional visual attachments */
  attachments?: ImageAttachment[];
  /** Optional file attachments (content injected into AI request, not shown in bubble) */
  fileAttachments?: FileAttachment[];
  /** 来源 Agent ID（跨 Agent 调用时标识调用方） */
  fromAgentId?: string;
  /** 来源 Agent 名称（跨 Agent 调用时显示） */
  fromAgentName?: string;
  /** Backend orchestration round index (intermediate, same stream) */
  orchestrationRound?: number;
  /** Tool count in the current orchestration round */
  orchestrationToolCount?: number;
  /** Tracked tool execution progress from backend orchestration */
  executedTools?: {
    tool_name: string;
    tool_call_id: string;
    result_preview: string;
    success: boolean;
    round: number;
    total_rounds_so_far: number;
  }[];
  /** Persisted subagent card snapshots for tool result messages (run_subagent / run_subagents / Agent / Task). */
  subagentRuns?: PersistedSubagentRun[];

  /** UI-only notice rendered outside message bubbles (not sent to the model). */
  uiNotice?: ChatUiNotice;

  /** 工具调用审批状态（仅运行时，不持久化） */
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  /** 审批摘要信息（用于显示工具详情） */
  approvalSummary?: ChatApprovalSummary;

  /** Context compact boundary marker message */
  compactBoundary?: boolean;
  /** Context compact summary message */
  compactSummary?: boolean;
  /** Metadata for compact boundary messages */
  compactMetadata?: CompactMetadata;
}

export interface ProviderSwitchNotice {
  type: 'provider-switch';
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
}

export type ChatUiNotice = ProviderSwitchNotice;

export type CompactType = 'auto' | 'manual' | 'abridged';

export interface CompactMetadata {
  compactedAt: number;
  compactType: CompactType;
  compactPath?: 'session_memory' | 'reactive' | 'traditional';
  headMessageId: string;
  anchorMessageId: string;
  tailMessageId: string;
  originalMessageIds: string[];
  summaryMessageId: string;
}

export interface CompactState {
  turnsSincePreviousCompact: number;
  lastCompactedAt?: number;
}

/**
 * Tracks whether project path context has been injected for a conversation.
 * Uses fingerprinting (pathHash) to detect path changes and re-inject.
 */
export interface ProjectPathInjectionState {
  /** Whether injection has been committed */
  injected: boolean;
  /** Hash of the project path that was injected */
  pathHash: string;
  /** Timestamp when injection was committed */
  injectedAt: number;
}

/**
 * Per-thread composer and approval settings snapshot
 */
export interface AgentThreadSettings {
  accessMode?: AgentAccessMode;
  reasoningEffort?: ReasoningEffort;
  provider?: string;
  model?: string;
  profileId?: string;
  /** When `auto`, requests use the auto-routing chain from settings. */
  routingMode?: AgentRoutingMode;
}

/**
 * Line-level or file-level review comment on a pending change
 */
export interface ChangeReviewComment {
  id: string;
  filePath: string;
  side: 'old' | 'new';
  lineNumber?: number;
  body: string;
  createdAt: number;
  updatedAt?: number;
  submittedAt?: number;
}

/**
 * Agent conversation containing messages and preview history
 */
export interface AgentConversation {
  /** Unique conversation identifier */
  id: string;
  /** Conversation title */
  title: string;
  /** Workspace path this thread belongs to */
  projectPath?: string;
  /** Per-thread settings snapshot */
  threadSettings?: AgentThreadSettings;
  /** Read-only branch snapshot at creation or last activity */
  branchName?: string;
  /** List of messages in the conversation */
  messages: ChatMessage[];
  /** Preview history for file changes */
  previewHistory: PreviewHistoryEntry[];
  /** Current preview index */
  currentPreviewIndex: number;
  /** Conversation creation timestamp */
  createdAt: number;
  /** Conversation last update timestamp */
  updatedAt: number;
  /** Whether title has been auto-generated */
  titleGenerated?: boolean;
  /** Tracks what context has been injected into this conversation */
  contextInjected?: {
    projectPath?: ProjectPathInjectionState;
    rules?: {
      injected: boolean;
      /** Hash of the rules content that was injected, for change detection */
      contentHash?: string;
    };
  };
  /** Change review comments for this thread */
  reviewComments?: ChangeReviewComment[];
  /** Context compact turn tracking */
  compactState?: CompactState;
  /** Plan panel document — follows this thread on save/delete */
  planDocument?: {
    content: string;
    title: string;
    status: 'draft' | 'pending_review' | 'accepted' | 'rejected';
    updatedAt: number;
  } | null;
}

/**
 * Agent conversation state management
 */
export interface AgentConversationState {
  /** Currently selected conversation ID (active project shortcut) */
  selectedConversationId: string | null;
  /** Per-project selected thread */
  selectedConversationIdByProject?: Record<string, string | null>;
  /** List of all conversations */
  conversations: AgentConversation[];
}

/**
 * Stream chunk payload from AI provider
 */
export interface StreamChunkPayload {
  /** Message identifier */
  message_id: string;
  /** Text chunk content */
  chunk: string;
  /** Chunk type identifier */
  chunk_type: string;
}

/**
 * Stream completion payload with tool calls and usage stats
 */
export interface StreamCompletePayload {
  /** Message identifier */
  message_id: string;
  /** Tool calls made during streaming */
  tool_calls?: ToolCall[];
  /** Token usage statistics */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** Anthropic: tokens read from cache */
    cache_read_input_tokens?: number;
    /** Anthropic: tokens written to cache */
    cache_creation_input_tokens?: number;
  };
  /** Thinking block signature (Anthropic extended thinking) */
  thinking_signature?: string;
  /** Actual provider used (may differ from initial if auto-routing switched) */
  provider?: string;
  /** Actual model used (may differ from initial if auto-routing switched) */
  model?: string;
}

/**
 * Stream error payload
 */
export interface StreamErrorPayload {
  /** Message identifier (optional) */
  message_id?: string;
  /** Error message */
  error: string;
}

/**
 * Stream metadata for agent and conversation tracking
 */
export type StreamMeta = {
  /** Agent identifier */
  agentId: string;
  /** Conversation identifier */
  conversationId: string;
  /** Session key for busy-state tracking */
  sessionKey: string;
};

/**
 * Agent busy state change event detail
 */
export type AgentBusyChangeDetail = {
  /** Panel identifier */
  panelId: string;
  /** Busy state */
  busy: boolean;
};

/**
 * Provider request message format
 */
export type ProviderRequestMessage = {
  /** Message role */
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** Message content */
  content: string | null;
  /** Tool call ID (for tool responses) */
  tool_call_id?: string;
  /** Tool calls to execute */
  tool_calls?: ToolCall[];
  /** Optional visual attachments */
  attachments?: unknown[];
  /** Thinking content for Anthropic extended thinking (only sent to Anthropic) */
  thinking?: string;
  /** Thinking block signature for Anthropic extended thinking (only sent to Anthropic) */
  thinkingSignature?: string;
};

/**
 * Agent event constants
 */
export const AGENT_BUSY_CHANGE_EVENT = 'loom:agent-busy-change';
export const AGENT_CHAT_CONVERSATIONS_STORAGE_KEY = 'loom:agent-chat-conversations:v3';
export const PENDING_CHANGES_STORAGE_KEY = 'loom:pending-changes:v1';
export const AGENT_SESSION_EXTRAS_STORAGE_KEY = 'loom:agent-session-extras:v1';
export const AGENT_MODES_STORAGE_KEY = 'loom:agent-modes:v1';
export const CHAT_MODES_STORAGE_KEY = 'loom:chat-modes:v1';
export const CHAT_LAST_CONVERSATION_STORAGE_KEY = 'loom:chat-last-conversation:v1';
export const MAX_PREVIEW_HISTORY = 30;
export const FILE_PERSIST_DEBOUNCE_MS = 800;
export const SESSION_EXTRAS_PERSIST_DEBOUNCE_MS = 800;
export const LOCAL_STORAGE_BACKUP_DEBOUNCE_MS = 10_000;
export const DEFAULT_PREVIEW_WIDTH = 420;
export const PREVIEW_MIN_WIDTH = 320;
export const PREVIEW_MAX_WIDTH = 640;
export const PROJECT_PATH_CONTEXT_PREFIX = '[Project Context] Current project path: ';

/**
 * Item in the stream chunk processing queue
 */
export interface StreamChunkQueueItem {
  /** Message identifier */
  message_id: string;
  /** Text chunk content */
  chunk: string;
  /** Chunk type identifier */
  chunk_type: string;
  /** Agent identifier */
  agentId: string;
  /** Conversation identifier */
  conversationId: string;
  /** Session key for per-thread busy/stop tracking */
  sessionKey: string;
  /** Timestamp when chunk was enqueued */
  chunkTime: number;
}
