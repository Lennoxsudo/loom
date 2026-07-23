import { normalizePathForCompare } from '../../utils/pathUtils';
import { type Agent, type AIProvider } from '../../utils/agentPersistence';
import type { ToolCall } from '../../types/ai';
// Import leaf modules only — avoid features/agent-engine index (pulls toolExecutor/registry).
import { parseToolArguments } from '../../features/agent-engine/argsParser';
import { findBestToolMatch } from '../../features/agent-engine/toolMatcher';
import { resolveUnderlyingToolName } from '../../features/agent-engine/toolRouter';
import { exportPlanForSave, hydratePlan } from '../../features/agent-engine/planStore';
import { recoverPlanFromMessages } from '../../features/agent-engine/planRecover';
import { applyContextBudget } from '../../utils/contextBudget';
import { coerceProjectPath, normalizeProjectPath } from '../../shared/lib/projectPath';

export { coerceProjectPath, normalizeProjectPath } from '../../shared/lib/projectPath';
import {
  buildCoreSystemPrompt,
  buildRuntimeIdentityPrompt,
  type CoreSystemInteractionMode,
} from '../../utils/coreSystemPrompt';
import {
  type ChatMessage,
  type AgentConversation,
  type AgentConversationState,
  type PreviewHistoryEntry,
  type ProviderRequestMessage,
  MAX_PREVIEW_HISTORY,
  PROJECT_PATH_CONTEXT_PREFIX,
} from '../../types/chat';
import type { PersistedSubagentRun } from '../../types/subagent';
import { parseProviderAndModel } from '../../utils/parseProviderAndModel';
import {
  reconcileProviderRequest,
  resolveActiveAutoRoutingRuntime,
  type AutoRoutingResolveOptions,
  type LoadedAiConfig,
} from '../../utils/aiProviderRuntime';
import {
  BUILTIN_PROFILE_ID,
  isBuiltinProtocol,
  toConfigProviderKey,
} from '../../utils/builtinGateway';
import type { AgentRoutingMode } from '../../utils/agentPersistence';

export { parseProviderAndModel };

export function createAssistantMessageId(): string {
  return `a-${crypto.randomUUID()}`;
}

export function createUserMessageId(): string {
  return `u-${crypto.randomUUID()}`;
}

export function resolveAgentRequestRuntime(
  agent: Agent,
  runtime?: {
    provider?: string | null;
    model?: string | null;
    profileId?: string | null;
  }
): { provider: AIProvider; model: string; profileId?: string } {
  const rawModel = runtime?.model?.trim() || agent.model?.trim() || '';
  const parsed = parseProviderAndModel(rawModel);
  const provider = (runtime?.provider?.trim() ||
    parsed.provider ||
    agent.provider ||
    'openai') as AIProvider;
  const model = parsed.model || rawModel;
  const profileId = runtime?.profileId?.trim() || parsed.profileId || agent.profileId || undefined;
  return { provider, model, profileId };
}

export function reconcileAgentRequestRuntime(
  config: LoadedAiConfig,
  agent: Agent,
  runtime?: {
    provider?: string | null;
    model?: string | null;
    profileId?: string | null;
  }
): { provider: AIProvider; model: string; profileId?: string } {
  const resolved = resolveAgentRequestRuntime(agent, runtime);
  if (isBuiltinProtocol(resolved.provider)) {
    const reconciled = reconcileProviderRequest(
      config,
      toConfigProviderKey('builtin'),
      resolved.model,
      BUILTIN_PROFILE_ID
    );
    return {
      provider: 'builtin',
      model: reconciled.model,
      profileId: BUILTIN_PROFILE_ID,
    };
  }
  return reconcileProviderRequest(config, resolved.provider, resolved.model, resolved.profileId);
}

export interface AgentRuntimeSnapshot {
  provider: AIProvider;
  model: string;
  profileId?: string;
  routingMode?: AgentRoutingMode;
}

export function reconcileRuntimeForAgentRequest(
  config: LoadedAiConfig,
  agent: Agent,
  runtime?: {
    provider?: string | null;
    model?: string | null;
    profileId?: string | null;
    routingMode?: AgentRoutingMode | null;
  },
  autoRoutingOptions?: AutoRoutingResolveOptions
): { provider: AIProvider; model: string; profileId?: string } | null {
  if (runtime?.routingMode === 'auto') {
    return resolveActiveAutoRoutingRuntime(config, runtime, autoRoutingOptions);
  }
  return reconcileAgentRequestRuntime(config, agent, runtime);
}

export function syncReconciledRuntimeIfChanged(
  agentRuntimeRef: { current: AgentRuntimeSnapshot },
  reconciled: AgentRuntimeSnapshot,
  onRuntimeReconciled?: (runtime: AgentRuntimeSnapshot) => void,
  options?: { skipUiSync?: boolean }
): void {
  const before = agentRuntimeRef.current;
  if (
    before.model === reconciled.model &&
    (before.profileId ?? '') === (reconciled.profileId ?? '') &&
    before.provider === reconciled.provider
  ) {
    return;
  }
  agentRuntimeRef.current = {
    ...reconciled,
    routingMode: before.routingMode,
  };
  console.warn('Agent runtime reconciled at send time:', { from: before, to: reconciled });
  if (!options?.skipUiSync && before.routingMode !== 'auto') {
    onRuntimeReconciled?.(reconciled);
  }
}

// ── Thinking Prompt 常量 ──
/** 幂等标记：用于检测 thinking 指令是否已注入 */
export const THINKING_PROMPT_MARKER = '[系统附加指令]';

/** 要求模型展示思考过程的指令文本 */
export const THINKING_PROMPT_TEXT =
  '在回答问题前，请先在<thinking>标签中展示你的思考过程，然后在标签外给出最终答案。例如：\n<thinking>\n这里是思考过程...\n</thinking>\n\n这里是最终答案。';

/**
 * 判断模型是否为原生推理模型（自带 reasoning / thinking 通道，无需注入 <thinking> 指令）。
 */
export function isNativeReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();

  if (/^(o1|o3|o4)(-|$)/.test(lower)) {
    return true;
  }

  const nativeMarkers = [
    'deepseek-r1',
    'deepseek-reasoner',
    'nemotron',
    'qwq',
    'magistral',
    'glm-z1',
    'minimax-m1',
    'reasoner',
    '-thinking',
    ':thinking',
    'reasoning',
  ] as const;

  return nativeMarkers.some((marker) => lower.includes(marker));
}

/**
 * 判断是否应为当前 provider/model 注入 thinking 指令。
 *
 * 仅对 OpenAI 兼容 provider 且非推理模型（o1-*）注入。
 * Anthropic / Ollama 各有自己的思考机制，不需要此指令。
 */
export function shouldInjectThinkingPrompt(provider: AIProvider, model: string): boolean {
  // OpenAI-compatible transports (including built-in gateway)
  if (provider !== 'openai' && provider !== 'builtin') return false;

  // o1 系列是原生推理模型，不需要 thinking 标签
  if (model.startsWith('o1-')) return false;

  // 原生推理模型自带 reasoning 通道，不再叠加 <thinking> 指令
  if (isNativeReasoningModel(model)) return false;

  return true;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isManualCancelError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return (
    message.includes('aborted') ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('operation is manually canceled') ||
    message.includes('manually canceled')
  );
}

function normalizePreviewHistory(raw: unknown): PreviewHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const objItem = item as Record<string, unknown>;
      return {
        filePath: typeof objItem.filePath === 'string' ? objItem.filePath : '',
        content: typeof objItem.content === 'string' ? objItem.content : '',
        originalContent:
          typeof objItem.originalContent === 'string' ? objItem.originalContent : undefined,
        modifiedContent:
          typeof objItem.modifiedContent === 'string' ? objItem.modifiedContent : undefined,
        language: typeof objItem.language === 'string' ? objItem.language : undefined,
      };
    })
    .filter((item) => item.filePath)
    .slice(0, MAX_PREVIEW_HISTORY);
}

function normalizePreviewIndex(index: unknown, historyLength: number): number {
  const maxIndex = Math.max(0, historyLength - 1);
  return typeof index === 'number' && Number.isFinite(index)
    ? Math.min(Math.max(0, index), maxIndex)
    : 0;
}

export function normalizeStoredMessages(raw: unknown): Record<string, ChatMessage[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const obj = raw as Record<string, unknown>;
  const out: Record<string, ChatMessage[]> = {};

  for (const [agentId, messages] of Object.entries(obj)) {
    if (!Array.isArray(messages)) continue;

    const normalized: ChatMessage[] = [];
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      const msg = message as Record<string, unknown>;
      const role =
        msg.role === 'assistant'
          ? 'assistant'
          : msg.role === 'user'
            ? 'user'
            : msg.role === 'tool'
              ? 'tool'
              : null;
      if (!role) continue;

      const createdAt =
        typeof msg.createdAt === 'number' && Number.isFinite(msg.createdAt)
          ? msg.createdAt
          : Date.now();
      const thinking = typeof msg.thinking === 'string' ? msg.thinking : undefined;
      const thinkingStartedAtRaw =
        typeof msg.thinkingStartedAt === 'number' && Number.isFinite(msg.thinkingStartedAt)
          ? msg.thinkingStartedAt
          : undefined;
      const thinkingEndedAtRaw =
        typeof msg.thinkingEndedAt === 'number' && Number.isFinite(msg.thinkingEndedAt)
          ? msg.thinkingEndedAt
          : undefined;
      const thinkingStartedAt = thinking ? (thinkingStartedAtRaw ?? createdAt) : undefined;
      const thinkingEndedAt = thinking
        ? (thinkingEndedAtRaw ?? (thinkingStartedAtRaw ? thinkingStartedAtRaw : undefined))
        : undefined;
      const assistantToolCalls = Array.isArray(msg.tool_calls)
        ? (msg.tool_calls as ToolCall[])
        : Array.isArray(msg.toolCalls)
          ? (msg.toolCalls as ToolCall[])
          : undefined;
      const toolCallId =
        typeof msg.tool_call_id === 'string'
          ? msg.tool_call_id
          : typeof msg.toolCallId === 'string'
            ? msg.toolCallId
            : undefined;
      const toolName =
        typeof msg.tool_name === 'string'
          ? msg.tool_name
          : typeof msg.toolName === 'string'
            ? msg.toolName
            : undefined;
      const toolArgs =
        msg.tool_args && typeof msg.tool_args === 'object'
          ? (msg.tool_args as Record<string, unknown>)
          : msg.toolArgs && typeof msg.toolArgs === 'object'
            ? (msg.toolArgs as Record<string, unknown>)
            : undefined;
      const attachments = Array.isArray(msg.attachments) ? msg.attachments : undefined;

      normalized.push({
        id: typeof msg.id === 'string' && msg.id.trim() ? msg.id : `${Date.now()}-${Math.random()}`,
        role,
        text: typeof msg.text === 'string' ? msg.text : '',
        thinking,
        isStreaming: false,
        isThinking: false,
        thinkingStartedAt,
        thinkingEndedAt,
        ...(role === 'assistant'
          ? {
              tool_calls: assistantToolCalls,
            }
          : null),
        ...(role === 'tool'
          ? {
              tool_call_id: toolCallId,
              tool_name: toolName,
              tool_args: toolArgs,
            }
          : null),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        // Preserve fields that Rust now round-trips
        ...(typeof msg.isError === 'boolean' ? { isError: msg.isError } : {}),
        ...(Array.isArray(msg.fileAttachments) && msg.fileAttachments.length > 0
          ? { fileAttachments: msg.fileAttachments }
          : {}),
        ...(typeof msg.fromAgentId === 'string' ? { fromAgentId: msg.fromAgentId } : {}),
        ...(typeof msg.fromAgentName === 'string' ? { fromAgentName: msg.fromAgentName } : {}),
        ...(Array.isArray(msg.executedTools) ? { executedTools: msg.executedTools } : {}),
        ...(typeof msg.thinkingSignature === 'string'
          ? { thinkingSignature: msg.thinkingSignature }
          : {}),
        ...(Array.isArray(msg.subagentRuns) && msg.subagentRuns.length > 0
          ? { subagentRuns: msg.subagentRuns as PersistedSubagentRun[] }
          : {}),
        ...(msg.slashCommand &&
        typeof msg.slashCommand === 'object' &&
        !Array.isArray(msg.slashCommand) &&
        typeof (msg.slashCommand as { name?: unknown }).name === 'string' &&
        typeof (msg.slashCommand as { displayText?: unknown }).displayText === 'string'
          ? {
              slashCommand: {
                name: (msg.slashCommand as { name: string }).name,
                args:
                  typeof (msg.slashCommand as { args?: unknown }).args === 'string'
                    ? (msg.slashCommand as { args: string }).args
                    : '',
                displayText: (msg.slashCommand as { displayText: string }).displayText,
              },
            }
          : {}),
        createdAt,
      });
    }

    out[agentId] = normalized;
  }

  return out;
}

export function buildConversationTitleFromMessages(
  messages: ChatMessage[],
  fallback = '新会话'
): string {
  const firstUserMessage = messages.find(
    (msg) => msg.role === 'user' && msg.text.trim().length > 0
  );
  if (!firstUserMessage) return fallback;
  const normalized = firstUserMessage.text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 24)}...`;
}

export function normalizeGeneratedTitle(rawTitle: string): string {
  let title = (rawTitle || '').trim();
  if (!title) return '';

  title = title
    .replace(/<think[\s\S]*?<\/think>/gi, ' ')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ')
    .replace(/<\/?(think|thinking)>/gi, ' ')
    .trim();

  if (title.startsWith('{') || title.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(title);
      const getString = (value: unknown): string | null =>
        typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
      if (Array.isArray(parsed)) {
        const extracted = parsed.map(getString).find((v) => v);
        if (extracted) title = extracted;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const extracted =
          getString(obj.title) ||
          getString(obj.name) ||
          getString(obj.text) ||
          getString(obj.content) ||
          getString(obj.summary);
        if (extracted) title = extracted;
      }
    } catch {
      // Keep original title when JSON parsing fails.
    }
  }

  const lines = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstMeaningfulLine =
    lines.find(
      (line) =>
        !(
          line.startsWith('{') ||
          line.startsWith('[') ||
          line.startsWith('"signature"') ||
          line.startsWith('signature')
        )
    ) ||
    lines[0] ||
    '';

  title = firstMeaningfulLine;
  title = title.replace(/^#+\s*/, '');
  title = title.replace(/^[`"'""'']+/, '').replace(/[`"'""'']+$/, '');
  title = title.replace(/^\{\s*"signature"\s*:\s*"[^"]*"\s*,?\s*/i, '');
  title = title.replace(/^\{\s*signature\s*:\s*[^,}]+,?\s*/i, '');
  title = title.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  title = title.replace(/[。！？.!?]+$/, '').trim();

  if (title.length > 20) {
    title = title.slice(0, 20).trim();
  }

  return title;
}

export function finalizeThinkingMessage(message: ChatMessage): ChatMessage {
  if (!message.thinking || message.thinking.trim().length === 0) {
    return {
      ...message,
      isThinking: false,
    };
  }

  const thinkingStartedAt = message.thinkingStartedAt ?? message.createdAt ?? Date.now();
  const thinkingEndedAt = message.thinkingEndedAt ?? Date.now();

  return {
    ...message,
    isThinking: false,
    thinkingStartedAt,
    thinkingEndedAt,
  };
}

function normalizeSelectedConversationIdByProject(
  map: Record<string, string | null> | undefined
): Record<string, string | null> | undefined {
  if (!map) return undefined;
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(map)) {
    out[normalizeProjectPath(key)] = value;
  }
  return out;
}

/** Prefer the persisted global selection's project when restoring an Agent window. */
export function resolveActiveProjectPath(
  state: AgentConversationState | undefined,
  fallbackProjectPath: string
): string {
  const fallback = coerceProjectPath(fallbackProjectPath).trim();
  if (!state?.selectedConversationId) {
    return fallback;
  }
  const selected = state.conversations.find(
    (conversation) => conversation.id === state.selectedConversationId
  );
  const selectedPath = coerceProjectPath(selected?.projectPath).trim();
  return selectedPath || fallback;
}

export function filterThreadsByProject(
  state: AgentConversationState | undefined,
  projectPath: string
): AgentConversation[] {
  if (!state) return [];
  const normalized = normalizeProjectPath(projectPath);
  return state.conversations.filter(
    (conversation) => normalizeProjectPath(conversation.projectPath ?? '') === normalized
  );
}

export interface AgentThreadListItem {
  id: string;
  title: string;
  updatedAt?: number;
  preview?: string;
  branchName?: string;
  sessionKey: string;
  projectPath: string;
}

export function conversationToThreadListItem(
  conversation: AgentConversation,
  projectKey: string,
  fallbackBranchName?: string | null
): AgentThreadListItem {
  const lastUser = [...conversation.messages].reverse().find((m) => m.role === 'user');
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    preview: lastUser?.text?.slice(0, 48),
    branchName: conversation.branchName ?? fallbackBranchName ?? undefined,
    sessionKey: buildPendingSessionKey(projectKey, conversation.id),
    projectPath: conversation.projectPath ?? '',
  };
}

export function groupThreadsByProject(
  state: AgentConversationState | undefined,
  projectPaths: string[],
  projectKeysByPath: Record<string, string>,
  fallbackBranchName?: string | null
): Record<string, AgentThreadListItem[]> {
  const grouped: Record<string, AgentThreadListItem[]> = {};
  for (const projectPath of projectPaths) {
    const pathKey = normalizeProjectPath(projectPath);
    const storageKey = projectKeysByPath[pathKey] ?? pathKey;
    grouped[pathKey] = filterThreadsByProject(state, projectPath).map((conversation) =>
      conversationToThreadListItem(conversation, storageKey, fallbackBranchName)
    );
  }
  return grouped;
}

export function collectProjectPathsFromState(
  state: AgentConversationState | undefined,
  recentPaths: string[],
  activePath?: string
): string[] {
  const pathByKey = new Map<string, string>();
  const addPath = (path: unknown) => {
    const trimmed = coerceProjectPath(path).trim();
    if (!trimmed) return;
    const key = normalizeProjectPath(trimmed);
    if (!pathByKey.has(key)) {
      pathByKey.set(key, trimmed);
    }
  };

  for (const path of recentPaths) {
    addPath(path);
  }
  addPath(activePath);

  if (state) {
    for (const conversation of state.conversations) {
      addPath(conversation.projectPath);
    }
  }

  return Array.from(pathByKey.values());
}

export function resolveSelectedThreadId(
  state: AgentConversationState | undefined,
  projectPath: string
): string | null {
  if (!state) return null;
  const normalized = normalizeProjectPath(projectPath);
  const fromMap = state.selectedConversationIdByProject?.[normalized];
  if (fromMap !== undefined) {
    if (fromMap === null) return null;
    if (state.conversations.some((c) => c.id === fromMap)) return fromMap;
  }
  if (
    state.selectedConversationId &&
    state.conversations.some((c) => c.id === state.selectedConversationId)
  ) {
    const selected = state.conversations.find((c) => c.id === state.selectedConversationId);
    if (selected && normalizeProjectPath(selected.projectPath ?? '') === normalized) {
      return state.selectedConversationId;
    }
  }
  const threads = filterThreadsByProject(state, projectPath);
  return threads[0]?.id ?? null;
}

export function applyPreferredThreadSelection(
  state: AgentConversationState,
  projectPath: string,
  preferredThreadId?: string
): AgentConversationState {
  if (!preferredThreadId) return state;
  if (!state.conversations.some((conversation) => conversation.id === preferredThreadId)) {
    return state;
  }
  const key = normalizeProjectPath(projectPath);
  return {
    ...state,
    selectedConversationId: preferredThreadId,
    selectedConversationIdByProject: {
      ...(state.selectedConversationIdByProject ?? {}),
      [key]: preferredThreadId,
    },
  };
}

export function migrateConversationStateForProject(
  state: AgentConversationState,
  fallbackProjectPath: string
): AgentConversationState {
  const normalizedFallback = normalizeProjectPath(fallbackProjectPath);
  const conversations = state.conversations.map((conversation) => ({
    ...conversation,
    projectPath:
      conversation.projectPath !== undefined && conversation.projectPath !== ''
        ? conversation.projectPath
        : normalizedFallback,
  }));

  const selectedConversationIdByProject = { ...(state.selectedConversationIdByProject ?? {}) };
  if (state.selectedConversationId !== undefined) {
    for (const conversation of conversations) {
      const key = normalizeProjectPath(conversation.projectPath ?? '');
      if (!(key in selectedConversationIdByProject)) {
        selectedConversationIdByProject[key] = null;
      }
    }
    if (!(normalizedFallback in selectedConversationIdByProject)) {
      selectedConversationIdByProject[normalizedFallback] = state.selectedConversationId;
    }
  }

  return backfillMissingConversationProjectPaths({
    ...state,
    conversations,
    selectedConversationIdByProject,
    selectedConversationId: resolveSelectedThreadId(
      { ...state, conversations, selectedConversationIdByProject },
      fallbackProjectPath
    ),
  });
}

export function createAgentConversation(
  _agentId: string,
  _agentName: string,
  projectPath = '',
  branchName?: string,
  threadSettings?: AgentConversation['threadSettings']
): AgentConversation {
  const now = Date.now();
  return {
    id: `conv_${now}_${Math.random().toString(16).slice(2, 8)}`,
    title: `会话`,
    projectPath: normalizeProjectPath(projectPath),
    branchName,
    threadSettings,
    createdAt: now,
    updatedAt: now,
    messages: [],
    previewHistory: [],
    currentPreviewIndex: 0,
    titleGenerated: false,
  };
}

export function ensureConversationStateForAgent(
  _agent: Agent,
  existingState?: AgentConversationState | null,
  _legacyPreview?: unknown
): AgentConversationState {
  if (!existingState || existingState.conversations.length === 0) {
    return {
      selectedConversationId: null,
      conversations: [],
    };
  }

  const conversations = existingState.conversations;
  const selectedConversationIdByProject = existingState.selectedConversationIdByProject;
  const rawSelected = existingState.selectedConversationId;

  if (rawSelected === null) {
    return {
      ...existingState,
      selectedConversationId: null,
      selectedConversationIdByProject,
      conversations,
    };
  }

  if (typeof rawSelected === 'string' && conversations.some((c) => c.id === rawSelected)) {
    return {
      ...existingState,
      selectedConversationId: rawSelected,
      selectedConversationIdByProject,
      conversations,
    };
  }

  let derived: string | null = null;
  if (selectedConversationIdByProject) {
    for (const conversationId of Object.values(selectedConversationIdByProject)) {
      if (conversationId && conversations.some((c) => c.id === conversationId)) {
        derived = conversationId;
        break;
      }
    }
  }
  if (!derived) {
    derived = conversations[0]?.id ?? null;
  }

  return {
    ...existingState,
    selectedConversationId: derived,
    selectedConversationIdByProject,
    conversations,
  };
}

export function normalizeStoredConversations(raw: unknown): Record<string, AgentConversationState> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const obj = raw as Record<string, unknown>;
  const out: Record<string, AgentConversationState> = {};

  for (const [agentId, stateValue] of Object.entries(obj)) {
    if (!stateValue || typeof stateValue !== 'object') continue;
    const stateObj = stateValue as Record<string, unknown>;
    const conversationsRaw = Array.isArray(stateObj.conversations) ? stateObj.conversations : [];
    const selectedConversationId =
      typeof stateObj.selectedConversationId === 'string' ? stateObj.selectedConversationId : null;
    const selectedConversationIdByProject = normalizeSelectedConversationIdByProject(
      stateObj.selectedConversationIdByProject &&
        typeof stateObj.selectedConversationIdByProject === 'object' &&
        !Array.isArray(stateObj.selectedConversationIdByProject)
        ? (stateObj.selectedConversationIdByProject as Record<string, string | null>)
        : undefined
    );
    const legacyPreviewHistory = normalizePreviewHistory(stateObj.previewHistory);
    const legacyPreviewIndex = normalizePreviewIndex(
      stateObj.currentPreviewIndex,
      legacyPreviewHistory.length
    );

    const conversations: AgentConversation[] = [];
    for (const item of conversationsRaw) {
      if (!item || typeof item !== 'object') continue;
      const convObj = item as Record<string, unknown>;

      const normalizedMessages = rehydrateToolMessages(
        normalizeStoredMessages({ [agentId]: convObj.messages })[agentId] ?? []
      );
      const createdAt =
        typeof convObj.createdAt === 'number' && Number.isFinite(convObj.createdAt)
          ? convObj.createdAt
          : Date.now();
      const updatedAt =
        typeof convObj.updatedAt === 'number' && Number.isFinite(convObj.updatedAt)
          ? convObj.updatedAt
          : createdAt;
      const previewHistory = normalizePreviewHistory(convObj.previewHistory);
      const currentPreviewIndex = normalizePreviewIndex(
        convObj.currentPreviewIndex,
        previewHistory.length
      );

      conversations.push({
        id:
          typeof convObj.id === 'string' && convObj.id.trim()
            ? convObj.id
            : `conv_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        title:
          typeof convObj.title === 'string' && convObj.title.trim()
            ? convObj.title
            : buildConversationTitleFromMessages(normalizedMessages),
        projectPath: typeof convObj.projectPath === 'string' ? convObj.projectPath : undefined,
        threadSettings: convObj.threadSettings as AgentConversation['threadSettings'],
        branchName: typeof convObj.branchName === 'string' ? convObj.branchName : undefined,
        createdAt,
        updatedAt,
        messages: normalizedMessages,
        previewHistory,
        currentPreviewIndex,
        // Preserve existing injection state or leave undefined for old conversations
        contextInjected: convObj.contextInjected as AgentConversation['contextInjected'],
        reviewComments: Array.isArray(convObj.reviewComments)
          ? (convObj.reviewComments as AgentConversation['reviewComments'])
          : undefined,
      });
    }

    if (legacyPreviewHistory.length > 0 && conversations.length > 0) {
      const fallbackTargetId =
        selectedConversationId && conversations.some((conv) => conv.id === selectedConversationId)
          ? selectedConversationId
          : conversations[0].id;
      const target = conversations.find((conv) => conv.id === fallbackTargetId);
      if (target && target.previewHistory.length === 0) {
        target.previewHistory = legacyPreviewHistory;
        target.currentPreviewIndex = legacyPreviewIndex;
      }
    }

    out[agentId] = backfillMissingConversationProjectPaths({
      selectedConversationId,
      selectedConversationIdByProject,
      conversations,
    });
  }

  return out;
}

function backfillMissingConversationProjectPaths(
  state: AgentConversationState
): AgentConversationState {
  const map = state.selectedConversationIdByProject ?? {};
  let changed = false;
  const conversations = state.conversations.map((conversation) => {
    if (coerceProjectPath(conversation.projectPath).trim()) return conversation;
    for (const [projectKey, conversationId] of Object.entries(map)) {
      if (conversationId === conversation.id) {
        changed = true;
        return { ...conversation, projectPath: projectKey };
      }
    }
    return conversation;
  });
  if (!changed) return state;
  return { ...state, conversations };
}

function resolvePersistedSelectedConversationId(
  state: AgentConversationState,
  conversations: AgentConversation[]
): string | null {
  const { selectedConversationId, selectedConversationIdByProject } = state;

  if (selectedConversationId === null) {
    return null;
  }

  if (selectedConversationId && conversations.some((conv) => conv.id === selectedConversationId)) {
    return selectedConversationId;
  }

  if (
    !selectedConversationIdByProject ||
    Object.keys(selectedConversationIdByProject).length === 0
  ) {
    return conversations[0]?.id ?? null;
  }

  return null;
}

export function normalizeMessageForDiskPersistence(message: ChatMessage): Record<string, unknown> {
  const {
    isStreaming: _isStreaming,
    isThinking: _isThinking,
    isProcessingTools: _isProcessingTools,
    tool_calls,
    tool_call_id,
    tool_name,
    tool_args,
    ...rest
  } = message;

  const normalized: Record<string, unknown> = { ...rest };

  if (tool_calls !== undefined) {
    normalized.toolCalls = tool_calls;
  }
  if (tool_call_id !== undefined) {
    normalized.toolCallId = tool_call_id;
  }
  if (tool_name !== undefined) {
    normalized.toolName = tool_name;
  }
  if (tool_args !== undefined) {
    normalized.toolArgs = tool_args;
  }

  return normalized;
}

export function inferToolMetadataFromResultText(
  text: string
): { tool_name: string; tool_args?: Record<string, unknown> } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (
    /^项目根目录:/m.test(trimmed) ||
    (trimmed.includes('├──') && /总计:\s*\d+\s*个目录/.test(trimmed))
  ) {
    const rootMatch = trimmed.match(/项目根目录:\s*(.+?)(?:\n|$)/);
    const path = rootMatch?.[1]?.trim();
    return {
      tool_name: 'get_file_tree',
      tool_args: path ? { path, root_path: path, rootPath: path } : {},
    };
  }

  const fileContentMatch = trimmed.match(/^文件内容\s*\(([^)]+)\)\s*:/);
  if (fileContentMatch) {
    const path = fileContentMatch[1].trim();
    return {
      tool_name: 'read_file',
      tool_args: { path, file_path: path },
    };
  }

  if (/^Terminal output:/i.test(trimmed) || /^Background command /i.test(trimmed)) {
    return { tool_name: 'read_terminal_output', tool_args: {} };
  }

  if (/^搜索结果\b/m.test(trimmed) || /^Search results\b/i.test(trimmed)) {
    return { tool_name: 'search_content', tool_args: {} };
  }

  if (/^Glob results\b/i.test(trimmed) || /^glob 搜索/i.test(trimmed)) {
    return { tool_name: 'search_files', tool_args: {} };
  }

  if (/^目录列表\b/m.test(trimmed) || /^Directory listing\b/i.test(trimmed)) {
    return { tool_name: 'list_directory', tool_args: {} };
  }

  if (/^Git diff\b/i.test(trimmed) || /^diff --git /m.test(trimmed)) {
    return { tool_name: 'get_git_diff', tool_args: {} };
  }

  if (trimmed.startsWith('```json') && trimmed.includes('"subagent_type"')) {
    return { tool_name: 'Agent', tool_args: {} };
  }

  if (/^\[Tool output compressed/m.test(trimmed) || /^tool:\s*read\b/im.test(trimmed)) {
    const embeddedPath = trimmed.match(/文件内容\s*\(([^)]+)\)\s*:/);
    if (embeddedPath) {
      const path = embeddedPath[1].trim();
      return {
        tool_name: 'read_file',
        tool_args: { path, file_path: path },
      };
    }
    return { tool_name: 'read_file', tool_args: {} };
  }

  return null;
}

export function rehydrateToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const toolCallById = new Map<string, { name: string; args: Record<string, unknown> }>();
  const orphanAssistantCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    for (const toolCall of message.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      const entry = { name: toolCall.function.name, args };
      toolCallById.set(toolCall.id, entry);
      orphanAssistantCalls.push(entry);
    }
  }

  let orphanIndex = 0;

  return messages.map((message) => {
    if (message.role !== 'tool' || message.tool_name) {
      return message;
    }

    let tool_name = message.tool_name;
    let tool_args = message.tool_args;
    const tool_call_id = message.tool_call_id;

    if (message.tool_call_id && toolCallById.has(message.tool_call_id)) {
      const matched = toolCallById.get(message.tool_call_id)!;
      tool_name = resolveUnderlyingToolName(matched.name, matched.args);
      tool_args = matched.args;
    } else if (orphanIndex < orphanAssistantCalls.length) {
      const matched = orphanAssistantCalls[orphanIndex++];
      tool_name = resolveUnderlyingToolName(matched.name, matched.args);
      tool_args = matched.args;
    } else {
      const inferred = inferToolMetadataFromResultText(message.text);
      if (inferred) {
        tool_name = inferred.tool_name;
        tool_args = inferred.tool_args;
      }
    }

    if (!tool_name) {
      return message;
    }

    return {
      ...message,
      tool_call_id,
      tool_name,
      tool_args,
    };
  });
}

export function sanitizeConversationStateForPersistence(
  state: AgentConversationState,
  options?: {
    stripMessages?: boolean;
  }
): AgentConversationState {
  const stripMessages = options?.stripMessages === true;
  const conversations = (state.conversations ?? []).map((conversation) => {
    const previewHistory = normalizePreviewHistory(conversation.previewHistory);
    const currentPreviewIndex = normalizePreviewIndex(
      conversation.currentPreviewIndex,
      previewHistory.length
    );
    const planDocument = exportPlanForSave(conversation.id) ?? conversation.planDocument ?? null;
    return {
      ...conversation,
      messages: stripMessages
        ? []
        : (conversation.messages ?? [])
            .filter((msg) => !msg.isStreaming)
            .map((msg) => {
              const { isStreaming: _isStreaming, isThinking: _isThinking, ...rest } = msg;
              return rest;
            }),
      previewHistory,
      currentPreviewIndex,
      planDocument,
    };
  });

  const selectedConversationId = resolvePersistedSelectedConversationId(state, conversations);

  return {
    selectedConversationId,
    selectedConversationIdByProject: state.selectedConversationIdByProject,
    conversations,
  };
}

export function toProjectConversationStateForPersistence(
  state: AgentConversationState,
  options?: {
    stripMessages?: boolean;
  }
): { selectedConversationId: string | null; conversations: AgentConversation[] } {
  const sanitized = sanitizeConversationStateForPersistence(state, options);
  return {
    selectedConversationId: sanitized.selectedConversationId,
    conversations: sanitized.conversations.map((conversation) => ({
      ...conversation,
      messages: (conversation.messages ?? []).map(
        (message) => normalizeMessageForDiskPersistence(message) as unknown as ChatMessage
      ),
    })),
  };
}

export function projectStateToAgentConversationState(
  projectState: { selectedConversationId: string | null; conversations: AgentConversation[] },
  projectPath: string
): AgentConversationState {
  const normalized = normalizeProjectPath(projectPath);
  const conversations = (projectState.conversations ?? []).map((conversation) => {
    const messages = rehydrateToolMessages(
      normalizeStoredMessages({ load: conversation.messages }).load ?? conversation.messages
    );
    // Prefer persisted planDocument; fall back to tool-history recovery for older saves
    // that dropped planDocument (Rust AgentConversation lacked the field).
    const planRaw = conversation.planDocument ?? recoverPlanFromMessages(messages) ?? null;
    hydratePlan(conversation.id, planRaw);
    const planDocument = exportPlanForSave(conversation.id) ?? planRaw ?? null;
    return {
      ...conversation,
      messages,
      planDocument,
    };
  });
  return {
    selectedConversationId: projectState.selectedConversationId,
    conversations,
    selectedConversationIdByProject: { [normalized]: projectState.selectedConversationId },
  };
}

export function emptyProjectConversationState(): AgentConversationState {
  return {
    selectedConversationId: null,
    conversations: [],
  };
}

export function toFileConversationStateForPersistence(
  state: AgentConversationState
): Record<string, unknown> {
  return {
    selectedConversationId: state.selectedConversationId,
    selectedConversationIdByProject: state.selectedConversationIdByProject,
    conversations: (state.conversations ?? []).map((conversation) => ({
      ...conversation,
      messages: (conversation.messages ?? []).map((message) =>
        normalizeMessageForDiskPersistence(message)
      ),
    })),
  };
}

function formatMessagesForProvider(
  messages: ProviderRequestMessage[],
  provider: AIProvider
): unknown[] {
  if (provider === 'anthropic') {
    // 第一遍：预收集所有 knownToolUseIds 和 seenToolResultIds
    // 必须先扫描完所有消息，才能在第二遍中准确判断哪些 tool_result 缺失
    const knownToolUseIds = new Set<string>();
    const seenToolResultIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          knownToolUseIds.add(toolCall.id);
        }
      }
      if (msg.role === 'tool' && msg.tool_call_id) {
        seenToolResultIds.add(msg.tool_call_id);
      }
    }

    // 第二遍：构建格式化消息，并补充缺失的 tool result
    const formatted: Array<{ role: string; content: unknown }> = [];
    const emittedToolResultIds = new Set<string>();

    for (const msg of messages) {
      // 现代 Anthropic API 支持 top-level system 参数。
      // 在这里直接保留 `system` 角色，让调用发起的底层机制（如 Rust backend）将其提取为顶级 system 配置。
      if (msg.role === 'system') {
        formatted.push({
          role: 'system',
          content: [{ type: 'text', text: msg.content ?? '' }],
        });
        continue;
      }

      if (msg.role === 'tool') {
        if (msg.tool_call_id) {
          if (!knownToolUseIds.has(msg.tool_call_id)) {
            continue;
          }
          if (emittedToolResultIds.has(msg.tool_call_id)) {
            continue;
          }
          const contentStr =
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
          const finalContent = contentStr.trim() === '' ? ' ' : contentStr;

          formatted.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id,
                content: finalContent,
              },
            ],
          });
          emittedToolResultIds.add(msg.tool_call_id);
        } else {
          formatted.push({
            role: 'user',
            content: msg.content ?? ' ',
          });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        const textContent = typeof msg.content === 'string' ? msg.content : '';

        if (textContent.trim().length > 0) {
          content.push({
            type: 'text',
            text: textContent,
          });
        }

        const declaredToolUseIds: string[] = [];
        for (const toolCall of msg.tool_calls) {
          declaredToolUseIds.push(toolCall.id);
          let input: Record<string, unknown> = {};
          try {
            const rawArgs =
              typeof toolCall.function.arguments === 'string'
                ? toolCall.function.arguments
                : JSON.stringify(toolCall.function.arguments ?? {});
            const parsedArgs = parseToolArguments(rawArgs);
            if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) {
              input = { ...(parsedArgs as Record<string, unknown>) };
            }
          } catch {
            // ignore parse errors
          }

          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input,
          });
        }

        formatted.push({
          role: 'assistant',
          content,
        });

        // 补充缺失的 tool result：如果该 assistant 声明了 tool_use 但某些 id
        // 在整个消息列表中没有对应的 tool result，需要补充占位消息。
        const missingIds = declaredToolUseIds.filter(
          (id) => !seenToolResultIds.has(id) && !emittedToolResultIds.has(id)
        );
        if (missingIds.length > 0) {
          formatted.push({
            role: 'user',
            content: missingIds.map((id) => ({
              type: 'tool_result',
              tool_use_id: id,
              content: '操作已取消',
            })),
          });
          for (const id of missingIds) {
            emittedToolResultIds.add(id);
          }
        }

        continue;
      }

      formatted.push({
        role: msg.role,
        content: msg.content ?? ' ',
        ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
      });
    }

    return formatted;
  }

  // OpenAI 格式也需要一致性检查：确保 tool 消息的 tool_call_id
  // 在前面 assistant 消息的 tool_calls 中存在，否则 API 会返回 400 错误。
  // 同时，如果 assistant 消息声明了 tool_calls 但缺少对应的 tool result，
  // 需要补充占位的 tool result 消息，否则 API 也会报错。
  const knownToolCallIds = new Set<string>();
  const seenToolResultIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.id.trim()) {
          knownToolCallIds.add(tc.id);
        }
      }
    }
    if (msg.role === 'tool' && msg.tool_call_id) {
      seenToolResultIds.add(msg.tool_call_id);
    }
  }

  // 第一遍：过滤掉孤立的和重复的 tool 消息
  const dedupedToolResultIds = new Set<string>();
  const filtered = messages.filter((msg) => {
    if (msg.role === 'tool') {
      if (!msg.tool_call_id) return false;
      // 跳过 tool_call_id 不在任何 assistant 消息的 tool_calls 中的 tool 消息
      if (!knownToolCallIds.has(msg.tool_call_id)) return false;
      // 跳过重复的 tool result（同一个 tool_call_id 出现多次）
      if (dedupedToolResultIds.has(msg.tool_call_id)) return false;
      dedupedToolResultIds.add(msg.tool_call_id);
    }
    return true;
  });

  // 第二遍：为每个有 tool_calls 的 assistant 消息补充缺失的 tool result
  // 需要按轮次处理，将占位消息插在对应 assistant 消息之后
  const result: typeof filtered = [];
  for (let i = 0; i < filtered.length; i++) {
    const msg = filtered[i];
    result.push(msg);

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // 收集该 assistant 消息声明的 tool_call_id
      const declaredIds = msg.tool_calls
        .map((tc) => tc.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

      // 检查后续已有的 tool result
      const existingResultIds = new Set<string>();
      for (let j = i + 1; j < filtered.length && filtered[j].role === 'tool'; j++) {
        const tcId = filtered[j].tool_call_id;
        if (tcId) {
          existingResultIds.add(tcId);
        }
      }

      // 补充缺失的 tool result 占位消息
      for (const id of declaredIds) {
        if (!existingResultIds.has(id) && !dedupedToolResultIds.has(id)) {
          result.push({
            role: 'tool',
            content: '操作已取消',
            tool_call_id: id,
          });
          dedupedToolResultIds.add(id);
        }
      }
    }
  }

  return result.map((msg) => ({
    role: msg.role,
    content: msg.content,
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
    ...(msg.tool_calls && msg.tool_calls.length > 0 ? { tool_calls: msg.tool_calls } : {}),
    ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
  }));
}

// ==================== 方法 16：formatMessagesForProvider 结果缓存 ====================

/**
 * 方法 16：带缓存的 formatMessagesForProvider 包装。
 *
 * 对未变化的消息前缀缓存转换结果，只重新转换新增的消息。
 * 由于 formatMessagesForProvider 包含 tool 链修复逻辑（需要全局扫描），
 * 这里采用"前缀缓存 + 增量转换 + 合并"的策略：
 * - 前缀部分（上次已转换过的消息）直接复用缓存
 * - 新增部分单独转换
 * - 合并后返回
 *
 * 注意：tool 链修复需要全局上下文，因此缓存仅用于消息数组的"追加"场景。
 * 如果中间消息被修改（如压缩、裁剪），缓存会自动失效。
 *
 * @param messages 待格式化的消息数组
 * @param provider AI provider
 * @param cache 缓存对象（可变，会被更新）
 */
export function formatMessagesForProviderCached(
  messages: ProviderRequestMessage[],
  provider: AIProvider,
  cache: { lastMessageCount: number; lastMessageHash: string; convertedPrefix: unknown[] }
): unknown[] {
  // 计算当前消息的签名（前缀部分）
  const prefixCount = Math.min(cache.lastMessageCount, messages.length);
  const currentPrefixHash = stableMessagePrefixHash(messages.slice(0, prefixCount));

  // 如果前缀未变化，只转换新增部分
  if (
    cache.convertedPrefix.length > 0 &&
    prefixCount === cache.lastMessageCount &&
    currentPrefixHash === cache.lastMessageHash
  ) {
    // 前缀命中缓存，只转换新增的消息
    if (messages.length > prefixCount) {
      const newMessages = messages.slice(prefixCount);
      const newConverted = formatMessagesForProvider(newMessages, provider);
      const result = [...cache.convertedPrefix, ...newConverted];
      // 更新缓存
      cache.lastMessageCount = messages.length;
      cache.lastMessageHash = stableMessagePrefixHash(messages);
      cache.convertedPrefix = result;
      return result;
    }
    // 没有新消息，直接返回缓存
    return cache.convertedPrefix;
  }

  // 缓存未命中（前缀变化或首次调用），全量转换
  const result = formatMessagesForProvider(messages, provider);
  cache.lastMessageCount = messages.length;
  cache.lastMessageHash = stableMessagePrefixHash(messages);
  cache.convertedPrefix = result;
  return result;
}

/**
 * 计算消息前缀的稳定哈希（用于检测前缀是否变化）。
 * 使用简单的字符串拼接 + 长度，避免完整 JSON 序列化的开销。
 */
function stableMessagePrefixHash(messages: ProviderRequestMessage[]): string {
  let hash = `${messages.length}|`;
  for (const msg of messages) {
    // 只取关键字段，避免 attachments 等大对象影响哈希
    const raw = msg.content as unknown;
    const contentStr = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw.length) : '';
    hash += `${msg.role}:${contentStr.length}|`;
  }
  return hash;
}

export function toProviderRequestMessages(messages: ChatMessage[]): ProviderRequestMessage[] {
  return messages
    .filter((msg) => !msg.uiNotice)
    .map((msg) => {
      if (msg.compactBoundary) {
        return {
          role: 'system' as const,
          content:
            '[Earlier conversation was compacted. Refer to the context summary message below.]',
        };
      }

      if (msg.compactSummary) {
        return {
          role: 'user' as const,
          content: `[Context Summary]\n${msg.text}`,
        };
      }

      if (msg.role === 'system') {
        return {
          role: 'system' as const,
          content: msg.text || '',
        };
      }

      if (msg.role === 'tool') {
        const content = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text ?? '');
        return {
          role: 'tool' as const,
          content,
          tool_call_id: msg.tool_call_id,
        };
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          role: 'assistant' as const,
          content: msg.text || null,
          tool_calls: msg.tool_calls,
        };
      }

      return {
        role: msg.role,
        content: msg.text,
        ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
      };
    });
}

export function appendToolMessages(
  requestMessages: ProviderRequestMessage[],
  toolMessages: ChatMessage[]
): ProviderRequestMessage[] {
  const merged = [...requestMessages];
  const knownAssistantToolCallIds = new Set(
    merged
      .filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
      .flatMap((m) => (m.tool_calls ?? []).map((tc) => tc.id))
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  );
  const existingToolCallIds = new Set(
    merged.filter((m) => m.role === 'tool' && m.tool_call_id).map((m) => m.tool_call_id)
  );

  for (const toolMsg of toolMessages) {
    const toolCallId = toolMsg.tool_call_id?.trim();
    if (!toolCallId) {
      continue;
    }
    if (!knownAssistantToolCallIds.has(toolCallId)) {
      continue;
    }
    if (existingToolCallIds.has(toolCallId)) continue;
    const content =
      typeof toolMsg.text === 'string' ? toolMsg.text : JSON.stringify(toolMsg.text ?? '');
    merged.push({
      role: 'tool' as const,
      content,
      tool_call_id: toolCallId,
    });
    existingToolCallIds.add(toolCallId);
  }

  return merged;
}

export function ensureAnthropicLeadingUser(
  requestMessages: ProviderRequestMessage[],
  projectPath: string
): ProviderRequestMessage[] {
  if (requestMessages.length === 0) {
    return requestMessages;
  }

  // 找到第一条非 system 消息的位置
  const firstNonSystemIdx = requestMessages.findIndex((m) => m.role !== 'system');
  // 如果不存在非 system 消息或第一条非 system 不是 assistant，无需处理
  if (firstNonSystemIdx === -1 || requestMessages[firstNonSystemIdx].role !== 'assistant') {
    return requestMessages;
  }

  const userPadding: ProviderRequestMessage = {
    role: 'user' as const,
    content:
      projectPath.trim().length > 0 ? `${PROJECT_PATH_CONTEXT_PREFIX}${projectPath}` : '继续',
  };

  // 在 system 消息之后、assistant 消息之前插入 user 消息
  return [
    ...requestMessages.slice(0, firstNonSystemIdx),
    userPadding,
    ...requestMessages.slice(firstNonSystemIdx),
  ];
}

/**
 * 上下文组装配置项。
 * 将 AgentPanel 中 3 个调用点的公共模式统一:
 *   system prompt → projectPath → 消息列表 → provider 格式化 → 预算裁剪
 */
export interface BuildContextOptions {
  /** Chat / Agent 交互模式，影响核心 system 提示词变体 */
  interactionMode?: CoreSystemInteractionMode;
  /** 是否注入 Loom 核心 system 提示词（子代理循环应设为 false） */
  includeCoreSystemPrompt?: boolean;
  /** Agent 描述 / system prompt（可选） */
  systemPrompt?: string;
  /** 项目路径（可选） */
  projectPath?: string;
  /** 是否需要注入 projectPath context（由调用方的 injection 状态机决定） */
  shouldInjectProjectPath?: boolean;
  /** Skills 上下文（可选，由调用方预加载） */
  skillsContext?: string;
  /** 已转换为 ProviderRequestMessage 的消息列表 */
  requestMessages: ProviderRequestMessage[];
  /** AI 提供商 */
  provider: AIProvider;
  /** 模型标识（用于预算计算） */
  model: string;
  /** 工具定义（可选） */
  tools?: unknown;
  /** 最大上下文窗口大小（token 数），优先于默认值 */
  maxContextTokens?: number;
  /** @deprecated Summary is persisted in conversation messages after compact */
  existingSummary?: import('../../utils/contextCompressor').CompressedSummary | null;
  /** 子代理目录注入（仅主会话） */
  subagentCatalog?: string;
  /** formatMessagesForProvider 的转换缓存（方法 16），用于增量转换优化 */
  formatConversionCache?: {
    lastMessageCount: number;
    lastMessageHash: string;
    convertedPrefix: unknown[];
  };
}

/**
 * 统一构建发送给 AI 的上下文。
 *
 * 封装公共流程:
 * 1. 注入 system prompt
 * 2. 注入 project path context（仅首次）
 * 3. 合并历史消息
 * 4. 处理 Anthropic leading user 约束
 * 5. 格式化为 provider 格式
 * 6. 应用上下文预算裁剪
 */
export function buildContextForRequest(options: BuildContextOptions): {
  messages: unknown[];
  tools: unknown;
} {
  const {
    interactionMode = 'always-allow',
    includeCoreSystemPrompt = true,
    systemPrompt,
    projectPath,
    shouldInjectProjectPath = false,
    skillsContext,
    requestMessages,
    provider,
    model,
    tools,
    maxContextTokens,
    subagentCatalog,
    formatConversionCache: _formatConversionCache,
  } = options;

  let messages: ProviderRequestMessage[] = [];

  // ① & ② 组合唯一的 System prompt
  // 拼接顺序按「最稳定 → 最易变」排列，使 Prompt Caching 前缀尽可能稳定：
  //   runtimeIdentity > coreSystemPrompt > agent.description > subagentCatalog >
  //   skillsContext > projectPath > thinking
  const systemLines: string[] = [];

  if (includeCoreSystemPrompt) {
    systemLines.push(buildRuntimeIdentityPrompt({ provider, model }));
    systemLines.push(buildCoreSystemPrompt({ planMode: interactionMode === 'plan' }));
  }

  // 3. agent.description（Agent 可选自定义，追加在核心提示词之后）
  if (systemPrompt && systemPrompt.trim()) {
    systemLines.push(systemPrompt.trim());
  }

  // 4. subagentCatalog（较稳定，只在 .claude/agents 变化时变）
  if (subagentCatalog && subagentCatalog.trim()) {
    systemLines.push(subagentCatalog.trim());
  }

  // 5. Skills 索引（较稳定，仅 name+description，完整内容通过 load_skill 工具按需加载）
  if (skillsContext && skillsContext.trim()) {
    systemLines.push(skillsContext.trim());
  }

  // 6. projectPath（首次注入后不再变）
  if (shouldInjectProjectPath && projectPath && projectPath.trim()) {
    systemLines.push(`${PROJECT_PATH_CONTEXT_PREFIX}${projectPath}`);
  }

  // 7. thinking 指令（取决于 provider+model，最易变）
  if (shouldInjectThinkingPrompt(provider, model)) {
    const alreadyInjected = systemLines.some((line) => line.includes(THINKING_PROMPT_MARKER));
    if (!alreadyInjected) {
      systemLines.push(`${THINKING_PROMPT_MARKER}\n${THINKING_PROMPT_TEXT}`);
    }
  }

  if (systemLines.length > 0) {
    messages.push({
      role: 'system' as const,
      content: systemLines.join('\n\n'),
    });
  }

  // ③ 历史消息 + 当前消息
  messages.push(...requestMessages);

  // ④ Anthropic 要求首条非 system 消息不能是 assistant
  if (provider === 'anthropic') {
    const firstNonSystem = messages.find((m) => m.role !== 'system');
    if (firstNonSystem && firstNonSystem.role === 'assistant') {
      messages = ensureAnthropicLeadingUser(messages, projectPath ?? '');
    }
  }

  // ⑤ 格式化为 provider 格式（使用缓存加速增量转换）
  const providerMessages = options.formatConversionCache
    ? formatMessagesForProviderCached(messages, provider, options.formatConversionCache)
    : formatMessagesForProvider(messages, provider);

  // ⑤b Anthropic 防御层：清洗出站 tool_use 名称
  //     即使旧对话历史中包含幻觉工具名，也能在发送前修正
  if (provider === 'anthropic' && tools) {
    const toolsArray = Array.isArray(tools) ? tools : [];
    const validToolNames = toolsArray
      .map((t: Record<string, unknown>) => t.name)
      .filter((n): n is string => typeof n === 'string');

    if (validToolNames.length > 0) {
      for (const msg of providerMessages) {
        const msgObj = msg as { role: string; content: unknown };
        if (msgObj.role === 'assistant' && Array.isArray(msgObj.content)) {
          for (const block of msgObj.content as Record<string, unknown>[]) {
            if (
              block.type === 'tool_use' &&
              typeof block.name === 'string' &&
              !validToolNames.includes(block.name)
            ) {
              const match = findBestToolMatch(block.name, validToolNames);
              if (match) {
                block.name = match;
              }
            }
          }
        }
      }
    }
  }

  // ⑥ 上下文预算裁剪（先压缩再裁剪）
  const budgetResult = applyContextBudget(
    providerMessages as { role: string; content: unknown }[],
    model,
    tools,
    undefined,
    maxContextTokens,
    undefined,
    provider
  );

  return { messages: budgetResult.messages, tools };
}

export const collectImagePathsFromMessages = (messages: ChatMessage[]): string[] => {
  const paths = new Set<string>();
  for (const message of messages) {
    if (!message.attachments || message.attachments.length === 0) continue;
    for (const attachment of message.attachments) {
      if (attachment.type !== 'image') continue;
      const path = attachment.path?.trim();
      if (!path) continue;
      paths.add(path);
    }
  }
  return Array.from(paths);
};

export const TERMINAL_TOOL_NAMES = new Set([
  'run_command',
  'read_terminal_output',
  'terminal',
  'term',
]);

export type PendingFileChange = {
  id: string;
  agentId: string;
  conversationId: string;
  filePath: string;
  existedBefore?: boolean;
  beforeContent: string | null;
  afterContent: string;
  toolName: string;
  oldSnippet?: string;
  newSnippet?: string;
  createdAt: number;
  updatedAt: number;
};

export function buildPendingSessionKey(projectKey: string, conversationId: string): string {
  return `${projectKey}::${conversationId}`;
}

export function parseStorageProjectKeyFromSessionKey(sessionKey: string): string {
  const separator = sessionKey.indexOf('::');
  if (separator <= 0) return '';
  return sessionKey.slice(0, separator);
}

export function buildComposeDraftSessionKey(projectKey: string): string {
  return `${projectKey}::__compose__`;
}

export function resolveDraftSessionKey(
  projectKey: string,
  conversationId: string | null | undefined
): string {
  return conversationId
    ? buildPendingSessionKey(projectKey, conversationId)
    : buildComposeDraftSessionKey(projectKey);
}

export function getShortFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export function removePreviewEntriesFromConversation(
  conversation: AgentConversationState['conversations'][number],
  filePaths: ReadonlySet<string>
): AgentConversationState['conversations'][number] {
  if (conversation.previewHistory.length === 0 || filePaths.size === 0) {
    return conversation;
  }

  const normalizedMatches = new Set(
    Array.from(filePaths, (filePath) => normalizePathForCompare(filePath).toLowerCase())
  );
  const matchesFilePath = (filePath: string) =>
    normalizedMatches.has(normalizePathForCompare(filePath).toLowerCase());

  const nextHistory = conversation.previewHistory.filter((item) => !matchesFilePath(item.filePath));
  if (nextHistory.length === conversation.previewHistory.length) {
    return conversation;
  }

  const safeIndex = Math.min(
    Math.max(conversation.currentPreviewIndex, 0),
    Math.max(conversation.previewHistory.length - 1, 0)
  );
  const removedBeforeCount = conversation.previewHistory
    .slice(0, safeIndex)
    .filter((item) => matchesFilePath(item.filePath)).length;
  const activeItem = conversation.previewHistory[safeIndex];
  const activeRemoved = activeItem ? matchesFilePath(activeItem.filePath) : false;

  let nextIndex = 0;
  if (nextHistory.length > 0) {
    nextIndex = activeRemoved
      ? Math.min(safeIndex - removedBeforeCount, nextHistory.length - 1)
      : safeIndex - removedBeforeCount;
  }

  return {
    ...conversation,
    previewHistory: nextHistory,
    currentPreviewIndex: Math.max(0, nextIndex),
  };
}
