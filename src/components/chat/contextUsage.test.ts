import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildChatContextUsage, CHAT_CONTEXT_RESERVE_TOKENS } from './contextUsage';
import { DEFAULT_CONTEXT_WINDOW, estimateToolsTokens } from '../../utils/contextBudget';
import { APP_DISPLAY_NAME } from '../../utils/coreSystemPrompt';

vi.mock('../../utils/skills', () => ({
  loadSkillsContext: vi.fn(),
}));

vi.mock('../../utils/subagents/contextPolicy', () => ({
  loadClaudeMd: vi.fn(async () => ''),
}));

import { loadSkillsContext } from '../../utils/skills';
import { loadClaudeMd } from '../../utils/subagents/contextPolicy';
import { getRulesContentHash } from '../../utils/rulesInjector';
import { PROJECT_PATH_CONTEXT_PREFIX } from '../../types/chat';

describe('buildChatContextUsage', () => {
  beforeEach(() => {
    vi.mocked(loadSkillsContext).mockResolvedValue(
      '<available_skills>\n"review": code review\n</available_skills>'
    );
    vi.mocked(loadClaudeMd).mockResolvedValue('');
  });

  it('includes injected rules, plan prompt, skills, and tool definitions in usage', async () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read file',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const result = await buildChatContextUsage({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Please inspect this project',
          timestamp: Date.now(),
        },
      ],
      provider: 'openai',
      model: 'gpt-4o',
      tools,
      projectPath: 'D:\\project\\demo',
      chatMode: 'plan',
      chatRules: [{ content: 'Always explain tradeoffs.' }],
      chatRulesInjected: false,
    });

    expect(result.maxContextTokens).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(result.availableContextTokens).toBe(
      DEFAULT_CONTEXT_WINDOW - CHAT_CONTEXT_RESERVE_TOKENS
    );
    expect(result.toolTokens).toBe(estimateToolsTokens(tools));
    expect(result.usedTokens).toBe(result.messageTokens + result.toolTokens);
    expect(result.usagePercent).toBeGreaterThan(0);

    // Rules 现在附加到首条 user 消息前缀（而非 system 消息），以保持 system prompt 稳定利于 Prompt Caching
    const userMessages = result.preparedMessages.filter(
      (message): message is { role: string; content: string } =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        'content' in message &&
        (message as { role?: string }).role === 'user' &&
        typeof (message as { content?: unknown }).content === 'string'
    );
    const firstUserText = userMessages[0]?.content ?? '';

    expect(firstUserText).toContain('[Rules Context]');
    expect(firstUserText).toContain('Always explain tradeoffs.');
    expect(firstUserText).toContain('【计划模式】');

    const systemMessages = result.preparedMessages.filter(
      (message): message is { role: string; content: string } =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        'content' in message &&
        (message as { role?: string }).role === 'system' &&
        typeof (message as { content?: unknown }).content === 'string'
    );
    const systemText = systemMessages.map((message) => message.content).join('\n\n');

    expect(systemText).toContain('<available_skills>');
    expect(systemText).toContain(APP_DISPLAY_NAME);
    expect(systemText).toContain('## Be concise');
    expect(systemText).toContain('read-only');
    expect(systemText).not.toContain('【计划模式】');
    expect(systemText).not.toContain('[Rules Context]');
  });

  it('does not inject thinking prompt for built-in models', async () => {
    const result = await buildChatContextUsage({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Explain this code',
          timestamp: Date.now(),
        },
      ],
      provider: 'builtin',
      model: 'deepseek-v4-pro',
      projectPath: '',
      chatMode: 'always-allow',
      chatRules: [],
      chatRulesInjected: true,
    });

    const systemText = result.preparedMessages
      .filter(
        (message): message is { role: string; content: string } =>
          typeof message === 'object' &&
          message !== null &&
          'role' in message &&
          'content' in message &&
          (message as { role?: string }).role === 'system' &&
          typeof (message as { content?: unknown }).content === 'string'
      )
      .map((message) => message.content)
      .join('\n\n');

    expect(systemText).not.toContain('[系统附加指令]');
    expect(systemText).not.toContain('<thinking>');
  });

  it('does not re-inject rules after they were already applied', async () => {
    const result = await buildChatContextUsage({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        },
      ],
      provider: 'openai',
      model: 'gpt-4o',
      projectPath: '',
      chatMode: 'always-allow',
      chatRules: [{ content: 'Rule once.' }],
      chatRulesInjected: true,
    });

    const systemText = result.preparedMessages
      .filter(
        (message): message is { role: string; content: string } =>
          typeof message === 'object' &&
          message !== null &&
          'role' in message &&
          'content' in message &&
          (message as { role?: string }).role === 'system' &&
          typeof (message as { content?: unknown }).content === 'string'
      )
      .map((message) => message.content)
      .join('\n\n');

    expect(systemText).not.toContain('[Rules Context]');
    expect(systemText).toContain(APP_DISPLAY_NAME);
  });

  it('re-injects chat rules when contentHash changes', async () => {
    const oldRules = 'Old rule.';
    const newRules = 'New rule after edit.';
    const result = await buildChatContextUsage({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        },
      ],
      provider: 'openai',
      model: 'gpt-4o',
      projectPath: '',
      chatMode: 'always-allow',
      chatRules: [{ content: newRules }],
      chatRulesInjected: true,
      chatRulesContentHash: getRulesContentHash(oldRules),
    });

    const userText =
      (
        result.preparedMessages.find(
          (message): message is { role: string; content: string } =>
            typeof message === 'object' &&
            message !== null &&
            'role' in message &&
            (message as { role?: string }).role === 'user' &&
            typeof (message as { content?: unknown }).content === 'string'
        )?.content ?? ''
      );

    expect(userText).toContain('[Rules Context]');
    expect(userText).toContain(newRules);
    expect(result.contextInjectedUpdate?.rules?.contentHash).toBe(getRulesContentHash(newRules));
  });

  it('injects project path and CLAUDE.md into chat system prompt', async () => {
    vi.mocked(loadClaudeMd).mockResolvedValue(
      '# Project Instructions (CLAUDE.md)\n\nUse Vitest.'
    );

    const result = await buildChatContextUsage({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        },
      ],
      provider: 'openai',
      model: 'gpt-4o',
      projectPath: 'D:\\project\\demo',
      chatMode: 'always-allow',
      chatRules: [],
      chatRulesInjected: true,
      conversation: {
        id: 'chat-1',
        title: 't',
        filename: 't.json',
        created_at: '',
        last_used_at: '',
        provider: 'openai',
        model: 'gpt-4o',
        messages: [],
      },
    });

    const systemText = result.preparedMessages
      .filter(
        (message): message is { role: string; content: string } =>
          typeof message === 'object' &&
          message !== null &&
          'role' in message &&
          (message as { role?: string }).role === 'system' &&
          typeof (message as { content?: unknown }).content === 'string'
      )
      .map((message) => message.content)
      .join('\n\n');

    expect(systemText).toContain(`${PROJECT_PATH_CONTEXT_PREFIX}D:\\project\\demo`);
    expect(systemText).toContain('Project Instructions (CLAUDE.md)');
    expect(result.contextInjectedUpdate?.projectPath?.injected).toBe(true);
  });

  it('keeps the same tool token count in plan mode when tools are unchanged', async () => {
    const baseMessages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'Inspect the repo',
        timestamp: Date.now(),
      },
    ];
    const readTool = {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read file',
        parameters: { type: 'object', properties: {} },
      },
    };
    const writeTool = {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write file',
        parameters: { type: 'object', properties: {} },
      },
    };
    const runTool = {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run command',
        parameters: { type: 'object', properties: {} },
      },
    };
    const fullTools = [readTool, writeTool, runTool];

    const planUsage = await buildChatContextUsage({
      messages: baseMessages,
      provider: 'openai',
      model: 'gpt-4o',
      tools: fullTools,
      projectPath: '',
      chatMode: 'plan',
      chatRules: [],
      chatRulesInjected: true,
    });
    const allowUsage = await buildChatContextUsage({
      messages: baseMessages,
      provider: 'openai',
      model: 'gpt-4o',
      tools: fullTools,
      projectPath: '',
      chatMode: 'always-allow',
      chatRules: [],
      chatRulesInjected: true,
    });

    expect(planUsage.toolTokens).toBe(allowUsage.toolTokens);
    // Plan mode injects [Plan Mode] guidance (and optional draft PLAN); token counts should differ.
    expect(planUsage.messageTokens).not.toBe(allowUsage.messageTokens);
  });
});
