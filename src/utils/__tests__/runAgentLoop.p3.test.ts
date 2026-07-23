/**
 * @module runAgentLoop P3 方法测试
 * - 方法 13: buildForkMessages
 * - 方法 14: filterToolsForSubagentType
 */
import { describe, it, expect } from 'vitest';
import { buildForkMessages, filterToolsForSubagentType } from '../runAgentLoop';
import type { ChatMessage } from '../../types/chat';

// ==================== 方法 13: buildForkMessages ====================

describe('buildForkMessages (方法 13)', () => {
  const makeMsg = (role: ChatMessage['role'], text: string, id?: string): ChatMessage => ({
    id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: Date.now(),
  });

  it('returns empty array for empty input', () => {
    const result = buildForkMessages([]);
    expect(result).toEqual([]);
  });

  it('returns all messages when count <= keepRounds * 2', () => {
    const messages = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const result = buildForkMessages(messages, 2);
    // 2 messages <= 2*2=4, so all returned as-is (no summary needed)
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
  });

  it('creates summary + recent messages when parent has many messages', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(makeMsg('user', `question ${i}`));
      messages.push(makeMsg('assistant', `answer ${i}`));
    }
    // 20 messages, keepRounds=2 → keep last 4, summarize first 16
    const result = buildForkMessages(messages, 2);
    // 1 summary + 4 recent = 5
    expect(result).toHaveLength(5);

    // First message should be the summary
    const summaryMsg = result[0];
    expect(summaryMsg.role).toBe('user');
    expect(typeof summaryMsg.text).toBe('string');
    expect(summaryMsg.text).toContain('Parent Context Summary');

    // Last 4 should be the original recent messages
    expect(result[1]).toBe(messages[16]);
    expect(result[2]).toBe(messages[17]);
    expect(result[3]).toBe(messages[18]);
    expect(result[4]).toBe(messages[19]);
  });

  it('summary includes user intents and tool calls', () => {
    const messages: ChatMessage[] = [
      makeMsg('user', 'Please read the config file'),
      {
        ...makeMsg('assistant', 'I read the file.'),
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      makeMsg('user', 'recent question'),
      makeMsg('assistant', 'recent answer'),
    ];
    // keepRounds=1 → keep last 2, summarize first 2
    const result = buildForkMessages(messages, 1);
    expect(result).toHaveLength(3); // 1 summary + 2 recent

    const summaryText = result[0].text as string;
    expect(summaryText).toContain('config file'); // user intent
    expect(summaryText).toContain('read_file'); // tool call
  });
});

// ==================== 方法 14: filterToolsForSubagentType ====================

describe('filterToolsForSubagentType (方法 14)', () => {
  const makeTool = (name: string) => ({ name, description: '', parameters: {} });

  it('excludes image generation tools for all subagent types', () => {
    const tools = [makeTool('read'), makeTool('generate_image'), makeTool('image_gen')];
    const result = filterToolsForSubagentType(tools, 'research');
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('filters to read-only tools for research type', () => {
    const tools = [
      makeTool('read'),
      makeTool('read_file'),
      makeTool('search'),
      makeTool('glob'),
      makeTool('grep'),
      makeTool('get_file_tree'),
      makeTool('write'),
      makeTool('edit'),
      makeTool('terminal'),
    ];
    const result = filterToolsForSubagentType(tools, 'research');
    const names = result.map((t) => t.name);
    expect(names).toContain('read');
    expect(names).toContain('search');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('get_file_tree');
    // Write tools should be excluded for research
    expect(names).not.toContain('write');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('terminal');
  });

  it('includes write tools for coder type', () => {
    const tools = [
      makeTool('read'),
      makeTool('write'),
      makeTool('edit'),
      makeTool('search'),
      makeTool('terminal'),
      makeTool('generate_image'),
    ];
    const result = filterToolsForSubagentType(tools, 'coder');
    const names = result.map((t) => t.name);
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('search');
    // terminal and image_gen not in coder preset
    expect(names).not.toContain('terminal');
    expect(names).not.toContain('generate_image');
  });

  it('does not filter for unknown subagent types (except excluded tools)', () => {
    const tools = [
      makeTool('read'),
      makeTool('write'),
      makeTool('terminal'),
      makeTool('generate_image'),
    ];
    const result = filterToolsForSubagentType(tools, 'custom-agent');
    const names = result.map((t) => t.name);
    // No preset for 'custom-agent', so all tools except excluded are kept
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('terminal');
    expect(names).not.toContain('generate_image');
  });

  it('falls back to unfiltered when preset results in empty', () => {
    // If no tools match the preset, return all (minus excluded)
    const tools = [makeTool('terminal'), makeTool('browser')];
    const result = filterToolsForSubagentType(tools, 'research');
    // Neither terminal nor browser is in research preset, but filtering would be empty
    // So fallback returns all (minus excluded, which none are)
    expect(result.length).toBe(2);
  });

  it('handles undefined subagentType', () => {
    const tools = [makeTool('read'), makeTool('write'), makeTool('generate_image')];
    const result = filterToolsForSubagentType(tools, undefined);
    // No preset applied, only excluded tools removed
    expect(result.map((t) => t.name)).toEqual(['read', 'write']);
  });
});
