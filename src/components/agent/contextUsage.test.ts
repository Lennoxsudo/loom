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
import { invoke } from '@tauri-apps/api/core';

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
      '<available_skills>\n"review": code review\n</available_skills>',
    );
    vi.mocked(invoke).mockResolvedValue('');
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
      DEFAULT_CONTEXT_WINDOW - AGENT_CONTEXT_RESERVE_TOKENS,
    );
    expect(usage.toolTokens).toBe(estimateToolsTokens(tools));
    expect(usage.messageTokens).toBeGreaterThan(0);
    expect(usage.usedTokens).toBe(usage.messageTokens + usage.toolTokens);
    expect(usage.usagePercent).toBeGreaterThan(0);
  });
});

describe('buildAgentRequestContext', () => {
  beforeEach(() => {
    vi.mocked(loadSkillsContext).mockResolvedValue('');
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
        typeof (message as { content?: unknown }).content === 'string',
    );

    expect(system?.content).toContain(`${APP_DISPLAY_NAME}`);
    expect(system?.content).toContain('openai/deepseek-v4-flash');
    expect(system?.content).not.toContain('anthropic/claude-sonnet-4-20250514');
  });
});
