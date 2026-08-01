import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAgentContextUsage,
  buildAgentRequestContext,
  AGENT_CONTEXT_RESERVE_TOKENS,
} from './contextUsage';
import { DEFAULT_CONTEXT_WINDOW, estimateToolsTokens } from '../../utils/contextBudget';
import { APP_DISPLAY_NAME } from '../../utils/coreSystemPrompt';
import type { Agent } from '../../utils/agentPersistence';
import type { AgentConversation } from '../../types/chat';

vi.mock('../../utils/skills', () => ({
  loadSkillsContext: vi.fn(),
}));

vi.mock('../../utils/subagents/contextPolicy', () => ({
  loadClaudeMd: vi.fn(async () => ''),
}));

vi.mock('../../utils/agentMemory', async () => {
  const actual = await vi.importActual<typeof import('../../utils/agentMemory')>(
    '../../utils/agentMemory'
  );
  return {
    ...actual,
    resolveAgentMemoryFrozenSnapshot: vi.fn(async () => ({
      text: '',
      justCaptured: false,
    })),
  };
});

vi.mock('../../utils/compact', () => ({
  maybeAutoCompactConversation: vi.fn(async ({ messages }) => ({
    messages,
    compacted: false,
    compactState: { lastCompactedAt: 0, lastCompactedMessageCount: 0 },
  })),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { loadSkillsContext } from '../../utils/skills';
import { loadClaudeMd } from '../../utils/subagents/contextPolicy';
import { resolveAgentMemoryFrozenSnapshot } from '../../utils/agentMemory';
import { invoke } from '@tauri-apps/api/core';
import { maybeAutoCompactConversation } from '../../utils/compact';

const baseAgent: Agent = {
  id: 'agent-1',
  name: 'Helper',
  type: 'custom',
  icon: 'bot',
  status: 'online',
  provider: 'openai',
  model: 'gpt-4o',
  description: 'You are a helpful coding assistant.',
  temperature: 0.7,
  capabilities: {
    canAccessBrowser: true,
    canExecuteCommands: true,
    canUseGit: true,
    canUseMcp: true,
  },
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

const baseConversation: AgentConversation = {
  id: 'conv-1',
  title: 'Test',
  messages: [
    {
      id: 'm1',
      role: 'user',
      text: 'Explain the current code.',
      createdAt: 1,
    },
  ],
  previewHistory: [],
  currentPreviewIndex: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe('buildAgentContextUsage', () => {
  beforeEach(() => {
    vi.mocked(loadSkillsContext).mockResolvedValue(
      '<available_skills>\n"review": code review\n</available_skills>'
    );
    vi.mocked(loadClaudeMd).mockResolvedValue('');
    vi.mocked(resolveAgentMemoryFrozenSnapshot).mockResolvedValue({
      text: '',
      justCaptured: false,
    });
    vi.mocked(invoke).mockResolvedValue('');
    vi.mocked(maybeAutoCompactConversation).mockClear();
    vi.mocked(maybeAutoCompactConversation).mockImplementation(async ({ messages }) => ({
      messages,
      compacted: false,
      compactState: { lastCompactedAt: 0, lastCompactedMessageCount: 0 },
      result: null,
    }));
  });

  it('includes agent memory and project instructions in system breakdown', async () => {
    vi.mocked(resolveAgentMemoryFrozenSnapshot).mockResolvedValue({
      text: '## Agent Memory (frozen for this session)\nprefer pnpm',
      justCaptured: false,
    });
    vi.mocked(loadClaudeMd).mockResolvedValue(
      '# Project Instructions (CLAUDE.md)\n\nUse Vitest.'
    );

    const withContext = await buildAgentContextUsage({
      agent: baseAgent,
      conversation: baseConversation,
      draftMessage: 'hello',
      attachedImages: [],
      projectPath: 'D:\\project\\demo',
      agentMode: 'always-allow',
      tools: [],
    });

    vi.mocked(resolveAgentMemoryFrozenSnapshot).mockResolvedValue({
      text: '',
      justCaptured: false,
    });
    vi.mocked(loadClaudeMd).mockResolvedValue('');
    const withoutContext = await buildAgentContextUsage({
      agent: baseAgent,
      conversation: baseConversation,
      draftMessage: 'hello',
      attachedImages: [],
      projectPath: 'D:\\project\\demo',
      agentMode: 'always-allow',
      tools: [],
    });

    expect(withContext.breakdown.system).toBeGreaterThan(withoutContext.breakdown.system);
  });

  it('includes agent request injections and tool definitions', async () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const usage = await buildAgentContextUsage({
      agent: {
        ...baseAgent,
        rules: 'Always explain tradeoffs.',
      },
      conversation: baseConversation,
      draftMessage: 'Then propose a refactor.',
      attachedImages: [],
      projectPath: 'D:\\project\\Loom\\Loom',
      agentMode: 'plan',
      tools,
    });

    expect(usage.maxContextTokens).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(usage.availableContextTokens).toBe(
      DEFAULT_CONTEXT_WINDOW - AGENT_CONTEXT_RESERVE_TOKENS
    );
    expect(usage.toolTokens).toBe(estimateToolsTokens(tools));
    expect(usage.messageTokens).toBeGreaterThan(0);
    expect(usage.usedTokens).toBe(usage.messageTokens + usage.toolTokens);
    expect(usage.usagePercent).toBeGreaterThan(0);
    expect(usage.breakdown.system).toBeGreaterThan(0);
    expect(usage.breakdown.tools).toBe(estimateToolsTokens(tools));
    expect(usage.compressionThresholdTokens).toBeGreaterThan(0);
    expect(usage.tokensUntilCompact).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(maybeAutoCompactConversation)).toHaveBeenCalledWith(
      expect.objectContaining({ skipCompact: true })
    );
  });
});

describe('buildAgentRequestContext', () => {
  beforeEach(() => {
    vi.mocked(loadSkillsContext).mockResolvedValue('');
    vi.mocked(loadClaudeMd).mockResolvedValue('');
    vi.mocked(resolveAgentMemoryFrozenSnapshot).mockResolvedValue({
      text: '',
      justCaptured: false,
    });
    vi.mocked(maybeAutoCompactConversation).mockImplementation(async ({ messages }) => ({
      messages,
      compacted: false,
      compactState: { turnsSincePreviousCompact: 0 },
      result: null,
    }));
  });

  it('injects CLAUDE.md / AGENTS.md into the system prompt', async () => {
    vi.mocked(loadClaudeMd).mockResolvedValue(
      '# Project Instructions (CLAUDE.md)\n\nPrefer Vitest.'
    );

    const { preparedMessages } = await buildAgentRequestContext({
      agent: baseAgent,
      provider: 'openai',
      model: 'gpt-4o',
      conversation: baseConversation,
      messages: baseConversation.messages,
      projectPath: 'D:\\project\\demo',
      agentMode: 'always-allow',
    });

    const system = preparedMessages.find(
      (message): message is { role: string; content: string } =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        (message as { role?: string }).role === 'system' &&
        typeof (message as { content?: unknown }).content === 'string'
    );

    expect(system?.content).toContain('Project Instructions (CLAUDE.md)');
    expect(system?.content).toContain('Prefer Vitest.');
  });

  it('uses the reconciled runtime model in the system prompt instead of agent.model', async () => {
    const { preparedMessages } = await buildAgentRequestContext({
      agent: {
        ...baseAgent,
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      },
      provider: 'openai',
      model: 'deepseek-v4-flash',
      conversation: baseConversation,
      messages: baseConversation.messages,
      projectPath: '',
      agentMode: 'always-allow',
    });

    const system = preparedMessages.find(
      (message): message is { role: string; content: string } =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        (message as { role?: string }).role === 'system' &&
        typeof (message as { content?: unknown }).content === 'string'
    );

    expect(system?.content).toContain(`${APP_DISPLAY_NAME}`);
    expect(system?.content).toContain('You are the active model: deepseek-v4-flash.');
    expect(system?.content).not.toContain('anthropic/claude-sonnet-4-20250514');
  });

  it('runs AI compact on assembled request context before provider formatting', async () => {
    vi.mocked(maybeAutoCompactConversation)
      .mockResolvedValueOnce({
        compacted: false,
        compactState: { turnsSincePreviousCompact: 0 },
        result: null,
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: 'Explain the current code.',
            createdAt: 1,
          },
          {
            id: 'm2',
            role: 'assistant',
            text: 'older reply',
            createdAt: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        compacted: true,
        compactState: { turnsSincePreviousCompact: 0 },
        result: null,
        messages: [
          {
            id: 'sys-1',
            role: 'system',
            text: 'system prompt',
          },
          {
            id: 'summary-1',
            role: 'user',
            text: '[AI compact summary]',
            compactSummary: true,
          },
          {
            id: 'tail-1',
            role: 'user',
            text: 'latest user turn',
          },
        ],
      });

    const { preparedMessages } = await buildAgentRequestContext({
      agent: baseAgent,
      provider: 'openai',
      model: 'gpt-4o',
      conversation: baseConversation,
      messages: [
        ...baseConversation.messages,
        {
          id: 'm2',
          role: 'assistant',
          text: 'older reply',
          createdAt: 2,
        },
      ],
      projectPath: 'D:\\project\\Loom\\Loom',
      agentMode: 'always-allow',
    });

    expect(vi.mocked(maybeAutoCompactConversation)).toHaveBeenCalled();
    expect(
      preparedMessages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'content' in message &&
          (message as { content?: unknown }).content === '[AI compact summary]'
      )
    ).toBe(true);
  });
});
