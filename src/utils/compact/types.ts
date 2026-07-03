/**
 * Context compact type definitions.
 * @module compact/types
 */

export type {
  CompactMetadata,
  CompactState,
  CompactType,
} from '../../types/chat';

export type CompactPath = 'session_memory' | 'reactive' | 'traditional';

export interface CompactableMessage {
  id: string;
  role: string;
  text?: string;
  content?: string;
  compactBoundary?: boolean;
  compactSummary?: boolean;
  compactMetadata?: import('../../types/chat').CompactMetadata;
  isStreaming?: boolean;
  uiNotice?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  tool_name?: string;
  [key: string]: unknown;
}

export interface CompactResult<T extends CompactableMessage = CompactableMessage> {
  messages: T[];
  compacted: boolean;
  compactPath: CompactPath | null;
  compactMetadata: import('../../types/chat').CompactMetadata | null;
  originalTokens: number;
  compressedTokens: number;
}

export interface CompactConversationOptions {
  messages: CompactableMessage[];
  budgetTokens: number;
  provider: string;
  model: string;
  profileId?: string;
  compactType?: import('../../types/chat').CompactType;
  keepLastRounds?: number;
  reactiveKeepMessageCount?: number;
}

export interface AutoCompactCheckOptions {
  messages: CompactableMessage[];
  budgetTokens: number;
  tools?: unknown;
  maxContextTokens?: number;
  reserveTokens?: number;
  compactState?: import('../../types/chat').CompactState | null;
}

export const DEFAULT_KEEP_ROUNDS = 2;
export const REACTIVE_KEEP_MESSAGE_COUNT = 40;
export const MIN_TURNS_BEFORE_RECOMPACT = 3;
export const RESERVE_TOKENS = 8192;
