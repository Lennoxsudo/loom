import { describe, it, expect } from 'vitest';
import { parseCompactResponse, buildCompactPrompt } from '../prompt';
import { groupMessagesByApiRound, splitByRoundRetention } from '../grouping';
import { buildPostCompactMessages } from '../compact';
import { shouldAutoCompact, computeCompressionThreshold } from '../autoCompact';
import type { CompactableMessage } from '../types';

describe('compact/prompt', () => {
  it('extracts summary block', () => {
    const raw = '<analysis>hidden</analysis>\n<summary>## Title\ncontent</summary>';
    expect(parseCompactResponse(raw)).toBe('## Title\ncontent');
  });

  it('builds base prompt with conversation text', () => {
    const prompt = buildCompactPrompt('base', 'hello world');
    expect(prompt).toContain('hello world');
    expect(prompt).toContain('<summary>');
    expect(prompt).toContain('task or objective');
    expect(prompt).toContain('Key decisions made');
  });
});

describe('compact/grouping', () => {
  const messages: CompactableMessage[] = [
    { id: '1', role: 'user', text: 'a' },
    { id: '2', role: 'assistant', text: 'b' },
    { id: '3', role: 'user', text: 'c' },
    { id: '4', role: 'assistant', text: 'd' },
    { id: '5', role: 'user', text: 'e' },
    { id: '6', role: 'assistant', text: 'f' },
  ];

  it('groups api rounds', () => {
    const rounds = groupMessagesByApiRound(messages);
    expect(rounds).toHaveLength(3);
  });

  it('splits retention by rounds', () => {
    const split = splitByRoundRetention(messages, 1);
    expect(split).not.toBeNull();
    expect(split!.keepIndices).toHaveLength(2);
    expect(split!.prefixIndices.length).toBeGreaterThan(0);
  });
});

describe('compact/buildPostCompactMessages', () => {
  it('replaces prefix with boundary and summary', () => {
    const messages: CompactableMessage[] = [
      { id: '1', role: 'user', text: 'old1' },
      { id: '2', role: 'assistant', text: 'old2' },
      { id: '3', role: 'user', text: 'keep1' },
      { id: '4', role: 'assistant', text: 'keep2' },
    ];
    const split = splitByRoundRetention(messages, 1)!;
    const { messages: result, metadata } = buildPostCompactMessages({
      messages: messages as CompactableMessage[],
      split,
      summaryText: '## Summary',
      compactType: 'auto',
      compactPath: 'session_memory',
    });

    expect(result.some((m) => m.compactBoundary)).toBe(true);
    expect(result.some((m) => m.compactSummary)).toBe(true);
    expect(metadata.originalMessageIds).toEqual(['1', '2']);
  });
});

describe('compact/autoCompact', () => {
  it('computes threshold from budget', () => {
    const threshold = computeCompressionThreshold({ maxContextTokens: 100_000 });
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThan(100_000);
  });

  it('does not compact when under threshold', () => {
    const messages: CompactableMessage[] = [
      { id: '1', role: 'user', text: 'hi' },
    ];
    const budget = computeCompressionThreshold({ maxContextTokens: 200_000 });
    expect(shouldAutoCompact({ messages, budgetTokens: budget })).toBe(false);
  });
});
