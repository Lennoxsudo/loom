import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildContextForRequest,
  shouldInjectThinkingPrompt,
  isNativeReasoningModel,
  ensureAnthropicLeadingUser,
  ensureConversationStateForAgent,
  appendToolMessages,
  normalizeStoredConversations,
  normalizeStoredMessages,
  sanitizeConversationStateForPersistence,
  normalizeMessageForDiskPersistence,
  inferToolMetadataFromResultText,
  rehydrateToolMessages,
  toProjectConversationStateForPersistence,
  projectStateToAgentConversationState,
  resolveDraftSessionKey,
  createAssistantMessageId,
  createUserMessageId,
  THINKING_PROMPT_MARKER,
  THINKING_PROMPT_TEXT,
} from './utils';
import { APP_DISPLAY_NAME } from '../../utils/coreSystemPrompt';
import type { ProviderRequestMessage, ChatMessage } from '../../types/chat';
import type { Agent } from '../../utils/agentPersistence';

// ── Type-safe accessor for provider-formatted messages ───────────────
/**
 * Generic accessor for provider-formatted messages returned by buildContextForRequest.
 * Avoids scattering `as any` throughout tests.
 */
interface ProviderMessage {
  role: string;
  content: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  type?: string;
}

function msg(result: { messages: unknown[] }, index: number): ProviderMessage {
  return result.messages[index] as ProviderMessage;
}

function msgs(result: { messages: unknown[] }): ProviderMessage[] {
  return result.messages as ProviderMessage[];
}

function systemText(result: { messages: unknown[] }): string {
  const system = msgs(result).find((message) => message.role === 'system');
  if (!system) return '';
  if (typeof system.content === 'string') {
    return system.content;
  }
  if (Array.isArray(system.content)) {
    return (system.content as { text?: string }[]).map((block) => block.text ?? '').join('');
  }
  return '';
}

// ── Canonicalization helper for snapshot stability ────────────────────
/**
 * Strips dynamic fields, sorts keys deterministically, and normalizes
 * null/undefined to ensure snapshot stability across runs.
 */
function canonicalize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalize);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    const val = (obj as Record<string, unknown>)[key];
    // Strip dynamic IDs that cause snapshot flakes
    if (key === 'tool_call_id' || key === 'tool_use_id' || key === 'id') {
      sorted[key] = '<STABLE>';
      continue;
    }
    sorted[key] = canonicalize(val);
  }
  return sorted;
}

// ── Phase 1: Context Assembly Regression Tests ──────────────────────

describe('Context Assembly Unity (Regression Tests)', () => {
  it('Task 4 Regression: should format identical configurations equally', () => {
    const rawMessages: ProviderRequestMessage[] = [
      { role: 'user', content: 'Show me the files' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'list_dir', arguments: '{"path":"/"}' },
          },
        ],
      },
      { role: 'tool', content: 'file1.ts, file2.ts', tool_call_id: 'tc_1' },
    ];

    // Simulate AgentPanel/ChatPanel utilizing the unified pipeline
    const result = buildContextForRequest({
      systemPrompt: 'You are a coder.',
      projectPath: '/root',
      shouldInjectProjectPath: true,
      requestMessages: rawMessages,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      tools: undefined,
    });

    // 1. First msg is the merged system prompt containing both instructions and project path
    const system = msg(result, 0);
    expect(system.role).toBe('system');
    const systemContent = system.content as { text: string }[];
    expect(systemContent[0].text).toContain(APP_DISPLAY_NAME);
    expect(systemContent[0].text).toContain('## Be concise');
    expect(systemContent[0].text).toContain('You are a coder.');
    expect(systemContent[0].text).toContain('/root');

    // 2. User message
    expect(msg(result, 1).role).toBe('user');

    // 3. Assistant tool call (Anthropic format: array of block objects)
    const assistantMsg = msg(result, 2);
    expect(assistantMsg.role).toBe('assistant');
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    const assistantBlocks = assistantMsg.content as { type: string; name?: string }[];
    expect(assistantBlocks[0].type).toBe('tool_use');
    expect(assistantBlocks[0].name).toBe('list_dir');

    // 4. Tool result (Anthropic format: user role with tool_result block)
    const toolMsg = msg(result, 3);
    expect(toolMsg.role).toBe('user');
    expect(Array.isArray(toolMsg.content)).toBe(true);
    const toolBlocks = toolMsg.content as { type: string; tool_use_id?: string }[];
    expect(toolBlocks[0].type).toBe('tool_result');
    expect(toolBlocks[0].tool_use_id).toBe('tc_1');
  });
});

// ── shouldInjectThinkingPrompt ──────────────────────────────────────
describe('shouldInjectThinkingPrompt', () => {
  it('should inject for standard OpenAI models', () => {
    expect(shouldInjectThinkingPrompt('openai', 'gpt-4o')).toBe(true);
    expect(shouldInjectThinkingPrompt('openai', 'gpt-4-turbo')).toBe(true);
    expect(shouldInjectThinkingPrompt('openai', 'gpt-3.5-turbo')).toBe(true);
  });

  it('should NOT inject for o1-* reasoning models', () => {
    expect(shouldInjectThinkingPrompt('openai', 'o1-preview')).toBe(false);
    expect(shouldInjectThinkingPrompt('openai', 'o1-mini')).toBe(false);
  });

  it('should NOT inject for Anthropic provider', () => {
    expect(shouldInjectThinkingPrompt('anthropic', 'claude-3-5-sonnet')).toBe(false);
  });

  it('should NOT inject for Ollama provider', () => {
    expect(shouldInjectThinkingPrompt('ollama', 'llama3')).toBe(false);
  });

  it('should NOT inject for native reasoning models', () => {
    expect(shouldInjectThinkingPrompt('openai', 'nvidia/nemotron-3-super-120b-a12b')).toBe(false);
    expect(shouldInjectThinkingPrompt('openai', 'deepseek-r1-distill')).toBe(false);
    expect(shouldInjectThinkingPrompt('openai', 'qwq-32b')).toBe(false);
    expect(shouldInjectThinkingPrompt('openai', 'o3-mini')).toBe(false);
  });
});

describe('isNativeReasoningModel', () => {
  it('matches OpenAI o-series prefixes', () => {
    expect(isNativeReasoningModel('o1-preview')).toBe(true);
    expect(isNativeReasoningModel('o3-mini')).toBe(true);
    expect(isNativeReasoningModel('o4')).toBe(true);
    expect(isNativeReasoningModel('gpt-4o')).toBe(false);
  });

  it('matches vendor reasoning model markers', () => {
    expect(isNativeReasoningModel('nvidia/nemotron-3-super-120b-a12b')).toBe(true);
    expect(isNativeReasoningModel('deepseek-reasoner')).toBe(true);
    expect(isNativeReasoningModel('deepseek-r1')).toBe(true);
    expect(isNativeReasoningModel('qwen-qwq')).toBe(true);
    expect(isNativeReasoningModel('magistral-medium')).toBe(true);
    expect(isNativeReasoningModel('glm-z1-preview')).toBe(true);
    expect(isNativeReasoningModel('minimax-m1')).toBe(true);
  });

  it('matches thinking / reasoning suffix patterns', () => {
    expect(isNativeReasoningModel('some-model-reasoner')).toBe(true);
    expect(isNativeReasoningModel('some-model-thinking')).toBe(true);
    expect(isNativeReasoningModel('some:thinking')).toBe(true);
    expect(isNativeReasoningModel('my-reasoning-model')).toBe(true);
  });
});

// ── Thinking prompt injection inside buildContextForRequest ─────────
describe('buildContextForRequest — thinking prompt injection', () => {
  const baseMessages: ProviderRequestMessage[] = [{ role: 'user', content: 'Hello' }];

  it('should inject thinking marker for OpenAI gpt-4o', () => {
    const result = buildContextForRequest({
      requestMessages: baseMessages,
      provider: 'openai',
      model: 'gpt-4o',
    });
    const system = msg(result, 0);
    expect(system.role).toBe('system');
    expect(system.content as string).toContain(THINKING_PROMPT_MARKER);
    expect(system.content as string).toContain(THINKING_PROMPT_TEXT);
  });

  it('should NOT inject thinking for Anthropic', () => {
    const result = buildContextForRequest({
      systemPrompt: 'You are helpful.',
      requestMessages: baseMessages,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });
    const system = msg(result, 0);
    // System text should NOT contain the marker
    const textContent =
      typeof system.content === 'string'
        ? system.content
        : Array.isArray(system.content)
          ? (system.content as { text?: string }[]).map((b) => b.text ?? '').join('')
          : '';
    expect(textContent).not.toContain(THINKING_PROMPT_MARKER);
  });

  it('should NOT inject thinking for o1-preview', () => {
    const result = buildContextForRequest({
      requestMessages: baseMessages,
      provider: 'openai',
      model: 'o1-preview',
    });
    const text = systemText(result);
    expect(text).toContain(APP_DISPLAY_NAME);
    expect(text).not.toContain(THINKING_PROMPT_MARKER);
    expect(msg(result, 1).role).toBe('user');
  });

  it('should NOT inject thinking for nemotron reasoning models', () => {
    const result = buildContextForRequest({
      requestMessages: baseMessages,
      provider: 'openai',
      model: 'nvidia/nemotron-3-super-120b-a12b',
    });
    const text = systemText(result);
    expect(text).toContain(APP_DISPLAY_NAME);
    expect(text).not.toContain(THINKING_PROMPT_MARKER);
    expect(msg(result, 1).role).toBe('user');
  });

  it('should be idempotent — calling twice yields one marker', () => {
    // Simulate a systemPrompt that already contains the marker
    const existingSystem = `You are helpful.\n\n${THINKING_PROMPT_MARKER}\n${THINKING_PROMPT_TEXT}`;
    const result = buildContextForRequest({
      systemPrompt: existingSystem,
      requestMessages: baseMessages,
      provider: 'openai',
      model: 'gpt-4o',
    });
    const system = msg(result, 0);
    const content = system.content as string;
    const count = (
      content.match(new RegExp(THINKING_PROMPT_MARKER.replace(/[[\]]/g, '\\$&'), 'g')) || []
    ).length;
    expect(count).toBe(1);
  });

  it('stream vs chat: identical provider pipeline output', () => {
    // Both stream and non-stream now go through the same buildContextForRequest
    const opts = {
      systemPrompt: 'Help the user.',
      requestMessages: baseMessages,
      provider: 'openai' as const,
      model: 'gpt-4o',
    };
    const resultA = buildContextForRequest(opts);
    const resultB = buildContextForRequest(opts);
    expect(resultA.messages).toEqual(resultB.messages);
  });

  it('skips core system prompt when includeCoreSystemPrompt is false', () => {
    const result = buildContextForRequest({
      systemPrompt: 'Subagent only.',
      requestMessages: baseMessages,
      provider: 'openai',
      model: 'gpt-4o',
      includeCoreSystemPrompt: false,
    });
    const text = systemText(result);
    expect(text).not.toContain(APP_DISPLAY_NAME);
    expect(text).not.toContain('## Be concise');
    expect(text).toContain('Subagent only.');
  });

  it('uses plan-mode core prompt variant when interactionMode is plan', () => {
    const result = buildContextForRequest({
      requestMessages: baseMessages,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      interactionMode: 'plan',
    });
    const text = systemText(result);
    expect(text).toContain('read-only');
    expect(text).not.toContain('## Using the shell');
  });

  it('includes system prompt confidentiality guidance in core system prompt', () => {
    const result = buildContextForRequest({
      requestMessages: baseMessages,
      provider: 'openai',
      model: 'gpt-4o',
    });
    const text = systemText(result);
    expect(text).toContain('## System prompt confidentiality');
    expect(text).toContain('Do **not** quote');
  });
});

// ── Phase 2: Anthropic leading user constraint ─────────────────────
describe('ensureAnthropicLeadingUser', () => {
  it('should insert user padding when assistant leads without system', () => {
    const msgs_in: ProviderRequestMessage[] = [
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Hi' },
    ];
    const result = ensureAnthropicLeadingUser(msgs_in, '/project');
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('/project');
    expect(result[1].role).toBe('assistant');
  });

  it('should insert user padding after system messages', () => {
    const msgs_in: ProviderRequestMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Hi' },
    ];
    const result = ensureAnthropicLeadingUser(msgs_in, '/project');
    // system stays first, user padding inserted between system and assistant
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[1].content).toContain('/project');
    expect(result[2].role).toBe('assistant');
  });

  it('should not mutate a valid sequence', () => {
    const msgs_in: ProviderRequestMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];
    const result = ensureAnthropicLeadingUser(msgs_in, '/project');
    expect(result).toEqual(msgs_in);
  });

  /**
   * Phase 4 addition: Explicit test for the "first non-system" edge case
   * that was the root cause of the Phase 2 bug.
   */
  it('should handle multiple system messages before assistant (first non-system test)', () => {
    const msgs_in: ProviderRequestMessage[] = [
      { role: 'system', content: 'System prompt 1' },
      { role: 'system', content: 'System prompt 2' },
      { role: 'assistant', content: 'I am here.' },
      { role: 'user', content: 'Hi' },
    ];
    const result = ensureAnthropicLeadingUser(msgs_in, '/project');
    // Both system messages stay first
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('system');
    // User padding inserted after all system messages
    expect(result[2].role).toBe('user');
    expect(result[2].content).toContain('/project');
    // assistant follows
    expect(result[3].role).toBe('assistant');
    expect(result.length).toBe(5);
  });
});

describe('buildContextForRequest — Anthropic leading user via pipeline', () => {
  it('should auto-fix when system prompt hides leading assistant', () => {
    const msgs_in: ProviderRequestMessage[] = [
      { role: 'assistant', content: 'I am an agent.' },
      { role: 'user', content: 'Do something' },
    ];
    const result = buildContextForRequest({
      systemPrompt: 'You are helpful.',
      projectPath: '/myproject',
      requestMessages: msgs_in,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    });
    // The formatted output should have system, then user (padding), then assistant, then user
    const roles = msgs(result).map((m) => m.role);
    // system -> user (padding) -> assistant -> user (original)
    expect(roles[0]).toBe('system');
    expect(roles[1]).toBe('user');
    expect(roles[2]).toBe('assistant');
  });
});

// ── Phase 3: Injection state management ───────────────────────────
import {
  shouldInjectProjectPath as checkShouldInject,
  markInjectionPending,
  commitInjection,
  rollbackInjection,
  hashString,
  _resetPendingLocks,
} from '../../hooks/useContextInjectionState';
import type { AgentConversation } from '../../types/chat';

function makeConversation(overrides?: Partial<AgentConversation>): AgentConversation {
  return {
    id: 'conv_test',
    title: 'Test',
    messages: [],
    previewHistory: [],
    currentPreviewIndex: -1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('Context Injection State — persistence recovery', () => {
  beforeEach(() => _resetPendingLocks());

  it('old conversation without contextInjected should require injection', () => {
    const conv = makeConversation(); // no contextInjected field
    expect(checkShouldInject(conv, '/project')).toBe(true);
  });

  it('conversation with committed injection should NOT require injection', () => {
    const conv = makeConversation({
      contextInjected: {
        projectPath: {
          injected: true,
          pathHash: hashString('/project'),
          injectedAt: Date.now(),
        },
      },
    });
    expect(checkShouldInject(conv, '/project')).toBe(false);
  });

  it('should re-inject when project path changes', () => {
    const conv = makeConversation({
      contextInjected: {
        projectPath: {
          injected: true,
          pathHash: hashString('/old-project'),
          injectedAt: Date.now(),
        },
      },
    });
    expect(checkShouldInject(conv, '/new-project')).toBe(true);
  });
});

describe('Context Injection State — concurrency safe', () => {
  beforeEach(() => _resetPendingLocks());

  it('pending lock prevents concurrent injection', () => {
    const conv = makeConversation();
    expect(checkShouldInject(conv, '/project')).toBe(true);
    markInjectionPending('conv_test', 'req_1');
    // Now a concurrent check should return false
    expect(checkShouldInject(conv, '/project')).toBe(false);
  });

  it('commit releases lock and sets state', () => {
    markInjectionPending('conv_test', 'req_1');
    const state = commitInjection('conv_test', 'req_1', '/project');
    expect(state).toBeDefined();
    expect(state!.injected).toBe(true);
    expect(state!.pathHash).toBe(hashString('/project'));
    // After commit, a new check should see it as committed (via conversation state)
    const conv = makeConversation({
      contextInjected: { projectPath: state! },
    });
    expect(checkShouldInject(conv, '/project')).toBe(false);
  });

  it('rollback releases lock without committing', () => {
    const conv = makeConversation();
    markInjectionPending('conv_test', 'req_1');
    rollbackInjection('conv_test', 'req_1');
    // After rollback, injection should be needed again
    expect(checkShouldInject(conv, '/project')).toBe(true);
  });
});

// ── Phase 4: Canonicalized E2E Provider Snapshots ────────────────────

/**
 * Shared fixture: messages with system prompt, user, assistant tool call, tool result
 */
const FIXTURE_MESSAGES: ProviderRequestMessage[] = [
  { role: 'user', content: 'List files' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: 'tc_1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"/"}' } },
    ],
  },
  { role: 'tool', content: 'file1.ts, file2.ts', tool_call_id: 'tc_1' },
];

const SHARED_OPTIONS = {
  systemPrompt: 'You are a coding assistant.',
  projectPath: '/workspace',
  shouldInjectProjectPath: true,
  requestMessages: FIXTURE_MESSAGES,
  model: 'test-model',
};

describe('E2E Provider Payload Snapshots (canonicalized)', () => {
  // ── OpenAI ──────────────────────────────────────────────────────
  it('OpenAI: structural assertions + snapshot', () => {
    const result = buildContextForRequest({
      ...SHARED_OPTIONS,
      provider: 'openai',
    });
    const all = msgs(result);
    // Structural: first message should be system with content string
    expect(all[0].role).toBe('system');
    expect(typeof all[0].content).toBe('string');
    // Structural: assistant should have tool_calls array
    const assistant = all.find((m) => m.role === 'assistant' && m.tool_calls);
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant!.tool_calls)).toBe(true);
    // Structural: tool response should be role='tool'
    const tool = all.find((m) => m.role === 'tool');
    expect(tool).toBeDefined();
    expect(tool!.tool_call_id).toBeDefined();
    // Canonicalized snapshot
    expect(canonicalize(result.messages)).toMatchSnapshot();
  });

  // ── Anthropic ───────────────────────────────────────────────────
  it('Anthropic: structural assertions + snapshot', () => {
    const result = buildContextForRequest({
      ...SHARED_OPTIONS,
      provider: 'anthropic',
    });
    const all = msgs(result);
    // Structural: system message with content as array of text blocks
    expect(all[0].role).toBe('system');
    expect(Array.isArray(all[0].content)).toBe(true);
    // Structural: assistant tool_use block
    const assistant = all.find((m) => m.role === 'assistant' && Array.isArray(m.content));
    expect(assistant).toBeDefined();
    const assistantBlocks = assistant!.content as { type: string; name?: string }[];
    const toolUse = assistantBlocks.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse!.name).toBe('list_dir');
    // Structural: tool_result block in user role
    const toolResultMsg = all.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as { type?: string }[]).some((b) => b.type === 'tool_result')
    );
    expect(toolResultMsg).toBeDefined();
    // Canonicalized snapshot
    expect(canonicalize(result.messages)).toMatchSnapshot();
  });

  // ── Ollama ──────────────────────────────────────────────────────
  it('Ollama: structural assertions + snapshot', () => {
    const result = buildContextForRequest({
      ...SHARED_OPTIONS,
      provider: 'ollama',
    });
    const all = msgs(result);
    // Structural: system message should exist with string content (Ollama uses OpenAI-compatible format)
    expect(all[0].role).toBe('system');
    expect(typeof all[0].content).toBe('string');
    // Structural: tool response has role='tool'
    const tool = all.find((m) => m.role === 'tool');
    expect(tool).toBeDefined();
    // Canonicalized snapshot
    expect(canonicalize(result.messages)).toMatchSnapshot();
  });
});

// ── Phase 4: Stream vs Non-Stream Equivalence ─────────────────────

describe('Stream vs Non-stream request body equivalence', () => {
  const providers = ['openai', 'anthropic', 'ollama'] as const;

  providers.forEach((provider) => {
    it(`${provider}: buildContextForRequest is deterministic (stream == chat)`, () => {
      const opts = {
        systemPrompt: 'You are helpful.',
        requestMessages: [{ role: 'user' as const, content: 'Hello' }],
        provider,
        model: 'test-model',
      };
      const streamResult = buildContextForRequest(opts);
      const chatResult = buildContextForRequest(opts);
      expect(streamResult.messages).toEqual(chatResult.messages);
    });
  });
});

describe('appendToolMessages', () => {
  it('skips tool messages without tool_call_id or without a matching assistant tool call', () => {
    const requestMessages: ProviderRequestMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc_valid',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' },
          },
        ],
      },
    ];

    const toolMessages = [
      {
        id: 'tool-valid',
        role: 'tool',
        text: 'ok',
        createdAt: Date.now(),
        tool_call_id: 'tc_valid',
      },
      {
        id: 'tool-missing-id',
        role: 'tool',
        text: 'missing id',
        createdAt: Date.now(),
      },
      {
        id: 'tool-orphan',
        role: 'tool',
        text: 'orphan',
        createdAt: Date.now(),
        tool_call_id: 'tc_orphan',
      },
    ] as ChatMessage[];

    const result = appendToolMessages(requestMessages, toolMessages);

    expect(result).toEqual([
      requestMessages[0],
      {
        role: 'tool',
        content: 'ok',
        tool_call_id: 'tc_valid',
      },
    ]);
  });
});

describe('agent conversation history retention', () => {
  it('ensureConversationStateForAgent keeps a new agent conversation list empty until the first send', () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Helper',
      type: 'custom',
      icon: 'AI',
      status: 'online',
      model: 'gpt-4o',
      temperature: 0.7,
      capabilities: {
        canExecuteCommands: true,
        canAccessBrowser: true,
        canUseGit: true,
        canUseMcp: true,
      },
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    };

    const ensured = ensureConversationStateForAgent(agent, undefined, undefined);

    expect(ensured.selectedConversationId).toBeNull();
    expect(ensured.conversations).toEqual([]);
  });

  it('ensureConversationStateForAgent preserves conversations when selectedConversationId is null', () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Helper',
      type: 'custom',
      icon: 'AI',
      status: 'online',
      model: 'gpt-4o',
      temperature: 0.7,
      capabilities: {
        canExecuteCommands: true,
        canAccessBrowser: true,
        canUseGit: true,
        canUseMcp: true,
      },
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    };

    const persisted = {
      selectedConversationId: null,
      selectedConversationIdByProject: {
        'D:/project/foo': null,
        'D:/project/bar': 'conv-1',
      },
      conversations: [
        {
          id: 'conv-1',
          title: '会话 1',
          projectPath: 'D:/project/bar',
          createdAt: 1,
          updatedAt: 2,
          messages: [{ id: 'm1', role: 'user' as const, text: 'hello', createdAt: 1 }],
          previewHistory: [],
          currentPreviewIndex: 0,
        },
        {
          id: 'conv-2',
          title: '会话 2',
          projectPath: 'D:/project/foo',
          createdAt: 3,
          updatedAt: 4,
          messages: [],
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    };

    const normalized = normalizeStoredConversations({ 'agent-1': persisted })['agent-1'];
    const ensured = ensureConversationStateForAgent(agent, normalized, undefined);

    expect(ensured.conversations).toHaveLength(2);
    expect(ensured.selectedConversationId).toBeNull();
    expect(ensured.selectedConversationIdByProject?.['d:/project/bar']).toBe('conv-1');
    expect(ensured.selectedConversationIdByProject?.['d:/project/foo']).toBeNull();
  });

  it('ensureConversationStateForAgent derives selection when persisted id is invalid', () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Helper',
      type: 'custom',
      icon: 'AI',
      status: 'online',
      model: 'gpt-4o',
      temperature: 0.7,
      capabilities: {
        canExecuteCommands: true,
        canAccessBrowser: true,
        canUseGit: true,
        canUseMcp: true,
      },
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    };

    const ensured = ensureConversationStateForAgent(agent, {
      selectedConversationId: 'missing-conv',
      selectedConversationIdByProject: { 'D:/proj': 'conv-1' },
      conversations: [
        {
          id: 'conv-1',
          title: '会话 1',
          projectPath: 'D:/proj',
          createdAt: 1,
          updatedAt: 2,
          messages: [],
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    expect(ensured.conversations).toHaveLength(1);
    expect(ensured.selectedConversationId).toBe('conv-1');
  });

  it('normalizeStoredMessages keeps long histories instead of truncating to a fixed tail window', () => {
    const rawMessages = Array.from({ length: 120 }, (_, index) => ({
      id: `msg-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `message ${index}`,
      createdAt: index + 1,
    }));

    const normalized = normalizeStoredMessages({
      'agent-1': rawMessages,
    });

    expect(normalized['agent-1']).toHaveLength(120);
    expect(normalized['agent-1'][0].text).toBe('message 0');
    expect(normalized['agent-1'][119].text).toBe('message 119');
  });

  it('normalizeStoredConversations preserves full persisted conversation history', () => {
    const rawMessages = Array.from({ length: 95 }, (_, index) => ({
      id: `msg-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `conversation message ${index}`,
      createdAt: index + 1,
    }));

    const normalized = normalizeStoredConversations({
      'agent-1': {
        selectedConversationId: 'conv-1',
        conversations: [
          {
            id: 'conv-1',
            title: 'Long conversation',
            createdAt: 1,
            updatedAt: 2,
            messages: rawMessages,
            previewHistory: [],
            currentPreviewIndex: 0,
          },
        ],
      },
    });

    const messages = normalized['agent-1'].conversations[0].messages;
    expect(messages).toHaveLength(95);
    expect(messages[0].text).toBe('conversation message 0');
    expect(messages[94].text).toBe('conversation message 94');
  });

  it('normalizeStoredConversations ignores legacy Claude CLI session ids', () => {
    const normalized = normalizeStoredConversations({
      'agent-cli': {
        selectedConversationId: 'conv-cli',
        conversations: [
          {
            id: 'conv-cli',
            title: 'Claude Code 12345678',
            cliSessionId: '12345678-1234-1234-1234-123456789abc',
            createdAt: 1,
            updatedAt: 2,
            messages: [],
            previewHistory: [],
            currentPreviewIndex: 0,
          },
        ],
      },
    });

    expect(normalized['agent-cli'].conversations[0]).not.toHaveProperty('cliSessionId');
  });

  it('sanitizeConversationStateForPersistence removes streaming flags without dropping older history', () => {
    const messages = Array.from({ length: 110 }, (_, index) => ({
      id: `msg-${index}`,
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `persisted message ${index}`,
      createdAt: index + 1,
      isStreaming: index === 109,
      isThinking: false,
    }));

    const sanitized = sanitizeConversationStateForPersistence({
      selectedConversationId: 'conv-1',
      conversations: [
        {
          id: 'conv-1',
          title: 'Persist me',
          createdAt: 1,
          updatedAt: 2,
          messages,
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    const persistedMessages = sanitized.conversations[0].messages;
    expect(persistedMessages).toHaveLength(109);
    expect(persistedMessages[0].text).toBe('persisted message 0');
    expect(persistedMessages[108].text).toBe('persisted message 108');
    expect(persistedMessages.every((msg) => !('isStreaming' in msg))).toBe(true);
  });

  it('sanitizeConversationStateForPersistence preserves compose null selection', () => {
    const sanitized = sanitizeConversationStateForPersistence({
      selectedConversationId: null,
      selectedConversationIdByProject: {
        'd:\\project\\a': null,
        'd:\\project\\b': 'conv-b',
      },
      conversations: [
        {
          id: 'conv-a',
          title: 'Thread A',
          projectPath: 'D:\\project\\a',
          createdAt: 1,
          updatedAt: 2,
          messages: [{ id: 'm1', role: 'user', text: 'hello', createdAt: 1 }],
          previewHistory: [],
          currentPreviewIndex: 0,
        },
        {
          id: 'conv-b',
          title: 'Thread B',
          projectPath: 'D:\\project\\b',
          createdAt: 3,
          updatedAt: 4,
          messages: [],
          previewHistory: [],
          currentPreviewIndex: 0,
        },
      ],
    });

    expect(sanitized.selectedConversationId).toBeNull();
    expect(sanitized.selectedConversationIdByProject).toEqual({
      'd:\\project\\a': null,
      'd:\\project\\b': 'conv-b',
    });
    expect(sanitized.conversations).toHaveLength(2);
  });

  it('normalizeStoredConversations backfills missing projectPath from per-project map', () => {
    const normalized = normalizeStoredConversations({
      'agent-1': {
        selectedConversationId: 'conv-b',
        selectedConversationIdByProject: {
          'd:\\project\\b': 'conv-b',
        },
        conversations: [
          {
            id: 'conv-b',
            title: 'Orphan thread',
            createdAt: 1,
            updatedAt: 2,
            messages: [],
          },
        ],
      },
    });

    expect(normalized['agent-1']?.conversations[0]?.projectPath).toBe('d:/project/b');
  });

  it('sanitizeConversationStateForPersistence strips Claude CLI messages when requested', () => {
    const sanitized = sanitizeConversationStateForPersistence(
      {
        selectedConversationId: 'conv-cli',
        conversations: [
          {
            id: 'conv-cli',
            title: 'Claude Code 12345678',
            createdAt: 1,
            updatedAt: 2,
            messages: [
              {
                id: 'msg-1',
                role: 'user',
                text: 'hello',
                createdAt: 1,
              },
            ],
            previewHistory: [],
            currentPreviewIndex: 0,
          },
        ],
      },
      { stripMessages: true }
    );

    expect(sanitized.conversations[0].messages).toEqual([]);
    expect(sanitized.conversations[0]).not.toHaveProperty('cliSessionId');
  });

  it('normalizeMessageForDiskPersistence writes camelCase tool metadata for Rust storage', () => {
    const disk = normalizeMessageForDiskPersistence({
      id: 'tool-1',
      role: 'tool',
      text: 'ok',
      createdAt: 1,
      tool_call_id: 'call-1',
      tool_name: 'read_file',
      tool_args: { path: 'src/App.tsx' },
    });

    expect(disk).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'read_file',
      toolArgs: { path: 'src/App.tsx' },
    });
    expect(disk).not.toHaveProperty('tool_call_id');
    expect(disk).not.toHaveProperty('tool_name');
    expect(disk).not.toHaveProperty('tool_args');
  });

  it('toProjectConversationStateForPersistence round-trips tool metadata through disk shape', () => {
    const persistable = toProjectConversationStateForPersistence({
      selectedConversationId: 'conv-1',
      conversations: [
        {
          id: 'conv-1',
          title: 'Test',
          createdAt: 1,
          updatedAt: 1,
          previewHistory: [],
          currentPreviewIndex: 0,
          messages: [
            {
              id: 'tool-1',
              role: 'tool',
              text: 'file content',
              createdAt: 1,
              tool_call_id: 'call-1',
              tool_name: 'get_file_tree',
              tool_args: { path: '.' },
            },
          ],
        },
      ],
    });

    const diskMessage = persistable.conversations[0].messages[0] as unknown as Record<
      string,
      unknown
    >;
    expect(diskMessage.toolName).toBe('get_file_tree');
    expect(diskMessage.toolCallId).toBe('call-1');

    const restored = projectStateToAgentConversationState(persistable, 'D:/project/test');
    expect(restored.conversations[0].messages[0].tool_name).toBe('get_file_tree');
    expect(restored.conversations[0].messages[0].tool_call_id).toBe('call-1');
  });

  it('inferToolMetadataFromResultText recognizes file tree and read_file outputs', () => {
    expect(
      inferToolMetadataFromResultText('项目根目录: D:/project\n├── src\n总计: 1 个目录')
    ).toMatchObject({ tool_name: 'get_file_tree' });

    expect(
      inferToolMetadataFromResultText('文件内容 (src/App.tsx):\nexport default function App() {}')
    ).toMatchObject({
      tool_name: 'read_file',
      tool_args: { path: 'src/App.tsx' },
    });
  });

  it('rehydrateToolMessages repairs tool metadata from assistant tool_calls and result text', () => {
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: '',
        createdAt: 1,
        tool_calls: [
          {
            id: 'call-abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        text: '文件内容 (README.md):\n# Hello',
        createdAt: 2,
      },
      {
        id: 'tool-2',
        role: 'tool',
        text: '项目根目录: .\n├── src\n总计: 2 个目录',
        createdAt: 3,
      },
    ];

    const repaired = rehydrateToolMessages(messages);
    expect(repaired[1].tool_name).toBe('read_file');
    expect(repaired[1].tool_args).toEqual({ path: 'README.md' });
    expect(repaired[2].tool_name).toBe('get_file_tree');
  });

  it('normalizeStoredMessages and normalizeMessageForDiskPersistence preserve subagentRuns', () => {
    const subagentRuns = [
      {
        task: { id: 'tc-1', description: 'explore auth' },
        status: 'succeeded' as const,
        startedAt: 100,
        finishedAt: 200,
        steps: 2,
        result: {
          taskId: 'tc-1',
          status: 'succeeded' as const,
          summary: 'found login flow',
        },
      },
    ];

    const disk = normalizeMessageForDiskPersistence({
      id: 'tool-sub',
      role: 'tool',
      text: 'ok',
      createdAt: 1,
      tool_call_id: 'tc-1',
      tool_name: 'run_subagent',
      subagentRuns,
    });

    expect(disk.subagentRuns).toEqual(subagentRuns);

    const loaded = normalizeStoredMessages({ conv: [disk] }).conv?.[0];
    expect(loaded?.subagentRuns).toEqual(subagentRuns);
  });
});

describe('resolveDraftSessionKey', () => {
  it('uses compose key when no conversation id', () => {
    expect(resolveDraftSessionKey('proj-a', null)).toBe('proj-a::__compose__');
    expect(resolveDraftSessionKey('proj-a', undefined)).toBe('proj-a::__compose__');
  });

  it('scopes draft to project and conversation', () => {
    expect(resolveDraftSessionKey('proj-a', 'conv-1')).toBe('proj-a::conv-1');
    expect(resolveDraftSessionKey('proj-b', 'conv-1')).toBe('proj-b::conv-1');
  });
});

describe('message id factories', () => {
  it('createAssistantMessageId generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createAssistantMessageId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^a-[0-9a-f-]{36}$/);
    }
  });

  it('createUserMessageId generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createUserMessageId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^u-[0-9a-f-]{36}$/);
    }
  });
});
