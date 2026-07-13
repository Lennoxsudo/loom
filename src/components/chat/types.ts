import type { ChatMessage as AgentChatMessage, ProviderRequestMessage, ChatUiNotice, CompactMetadata, CompactState } from '../../types/chat';
import { toProviderRequestMessages, appendToolMessages } from '../agent/utils';

export type ChatPanelProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';
export type ChatProtocolSelection = ChatPanelProvider | 'auto';

export const PROVIDERS: { id: ChatPanelProvider; name: string }[] = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'ollama', name: 'Ollama' },
];

export const VISION_UNSUPPORTED_ERROR = 'VISION_UNSUPPORTED_ERROR';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatApprovalActionType = 'command' | 'file' | 'git' | 'mcp';

export interface ChatApprovalSummary {
  type: ChatApprovalActionType;
  toolName: string;
  label: string;
  detail?: string;
}

export interface ChatApprovalRequest {
  requestId: string;
  status: 'pending' | 'approved' | 'denied';
  summaries: ChatApprovalSummary[];
  toolCalls: ToolCall[];
  sourceAssistantMessageId?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  rawContent?: string;
  rawThinking?: string;
  /** Last thinking stream chunk appended (dedupe consecutive duplicates) */
  lastThinkingChunk?: string;
  /** Whether any chunk_type === 'thinking' was received from the backend */
  receivedThinkingChunks?: boolean;
  attachments?: ImageAttachment[];
  thinking?: string;
  isThinking?: boolean;
  tokens?: number;
  timestamp: number;
  isStreaming?: boolean;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  /** Whether this tool result message represents an error */
  isError?: boolean;
  /** Tool approval UI state (detailed rejection text stays in content for the model only) */
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  // Timing metrics
  startTime?: number;
  firstChunkTime?: number;
  firstContentTime?: number;
  endTime?: number;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  executedTools?: {
    tool_name: string;
    tool_call_id: string;
    result_preview: string;
    success: boolean;
    round: number;
    total_rounds_so_far: number;
  }[];
  /** UI-only notice (not sent to the model). */
  uiNotice?: ChatUiNotice;
  /** Context compact boundary marker */
  compactBoundary?: boolean;
  /** Context compact summary message */
  compactSummary?: boolean;
  compactMetadata?: CompactMetadata;
}

interface TokenCount {
  input: number;
  output: number;
}

interface ConversationMessage {
  id?: string;
  role: string;
  content: string;
  attachments?: ImageAttachment[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  thinking?: string;
  tokens?: TokenCount;
  timestamp: string;
  startTime?: number;
  firstChunkTime?: number;
  firstContentTime?: number;
  endTime?: number;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  compactBoundary?: boolean;
  compactSummary?: boolean;
  compactMetadata?: CompactMetadata;
}

/** Plan document embedded with the conversation (follows session save/delete). */
export interface ConversationPlanDocument {
  content: string;
  title: string;
  status: 'draft' | 'pending_review' | 'accepted' | 'rejected';
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  filename: string;
  created_at: string;
  last_used_at: string;
  provider: string;
  model: string;
  messages: ConversationMessage[];
  pendingChanges?: PendingFileChange[];
  compactState?: CompactState;
  /** In-session plan panel state — saved/loaded/deleted with this conversation */
  planDocument?: ConversationPlanDocument | null;
}

export interface ConversationMeta {
  id: string;
  title: string;
  filename: string;
  last_used_at: string;
}

export interface AttachedFile {
  path: string;
  name: string;
  id: string;
}

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

export interface PendingImageAttachment extends ImageAttachment {
  previewUrl: string;
}

export interface PendingFileChange {
  id: string;
  filePath: string;
  existedBefore?: boolean;
  beforeContent: string | null;
  afterContent: string;
  toolName: string;
  oldSnippet?: string;
  newSnippet?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatPanelProps {
  width: number;
  projectPath: string;
  onFilesChanged?: (paths: string[]) => void;
}

export type StreamSpeed = 'fast' | 'normal' | 'slow';

export type StreamChunkQueueItem = {
  message_id: string;
  chunk: string;
  chunk_type: string;
  chunkTime: number;
};

export const CHAT_ATTACH_ZONE_ID = 'chat-attach-zone';
export const CHAT_ATTACH_FILE_EVENT = 'loom:chat-attach-file';
export const CHAT_NEW_CONVERSATION_EVENT = 'loom:chat-new-conversation';

function toAgentChatMessages(messages: Message[]): AgentChatMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
    thinking: msg.thinking,
    isStreaming: msg.isStreaming,
    createdAt: msg.timestamp,
    tool_calls: msg.tool_calls,
    tool_call_id: msg.tool_call_id,
    tool_name: msg.tool_name,
    tool_args: msg.tool_args,
    attachments: msg.attachments,
    uiNotice: msg.uiNotice,
    compactBoundary: msg.compactBoundary,
    compactSummary: msg.compactSummary,
    compactMetadata: msg.compactMetadata,
  }));
}

export function toChatPanelProviderRequestMessages(messages: Message[]): ProviderRequestMessage[] {
  return toProviderRequestMessages(toAgentChatMessages(messages));
}

export function appendChatPanelToolMessages(
  requestMessages: ProviderRequestMessage[],
  toolMessages: Message[]
): ProviderRequestMessage[] {
  return appendToolMessages(requestMessages, toAgentChatMessages(toolMessages));
}
