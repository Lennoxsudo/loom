import { describe, expect, it } from 'vitest';
import {
  buildSnippet,
  formatSessionSearchOutput,
  parseSearchTerms,
  searchMessagesInConversations,
  textMatchesTerms,
} from '../sessionSearch';

describe('sessionSearch', () => {
  it('parses terms and matches AND semantics', () => {
    expect(parseSearchTerms('  Foo   Bar ')).toEqual(['foo', 'bar']);
    expect(textMatchesTerms('User prefers Foo and Bar', ['foo', 'bar'])).toBe(true);
    expect(textMatchesTerms('User prefers Foo', ['foo', 'bar'])).toBe(false);
  });

  it('builds snippets around the first match', () => {
    const text = 'aaa ' + 'x'.repeat(200) + ' keyword ' + 'y'.repeat(200);
    const snippet = buildSnippet(text, ['keyword'], 20);
    expect(snippet).toContain('keyword');
    expect(snippet.startsWith('…') || snippet.endsWith('…')).toBe(true);
  });

  it('searches conversations and respects limit / conversation filter', () => {
    const conversations = [
      {
        id: 'c1',
        title: 'Thread A',
        projectPath: 'D:/a',
        messages: [
          { id: 'm1', role: 'user', text: 'please use pnpm here', createdAt: 1 },
          { id: 'm2', role: 'assistant', text: 'ok', createdAt: 2 },
        ],
      },
      {
        id: 'c2',
        title: 'Thread B',
        projectPath: 'D:/a',
        messages: [{ id: 'm3', role: 'user', text: 'pnpm and docker', createdAt: 3 }],
      },
    ];

    const hits = searchMessagesInConversations(conversations, {
      terms: ['pnpm'],
      projectKey: 'key',
      projectPathFallback: 'D:/a',
      limit: 10,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.snippet.toLowerCase()).toContain('pnpm');

    const scoped = searchMessagesInConversations(conversations, {
      terms: ['pnpm'],
      projectKey: 'key',
      projectPathFallback: 'D:/a',
      conversationId: 'c2',
      limit: 10,
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.conversationId).toBe('c2');

    const limited = searchMessagesInConversations(conversations, {
      terms: ['pnpm'],
      projectKey: 'key',
      projectPathFallback: 'D:/a',
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });

  it('formats empty and non-empty output', () => {
    expect(
      formatSessionSearchOutput(
        { ok: true, hits: [], scannedConversations: 3, offset: 0, hasMore: false },
        'pnpm'
      )
    ).toMatch(/No matches/);

    const text = formatSessionSearchOutput(
      {
        ok: true,
        scannedConversations: 1,
        offset: 0,
        hasMore: true,
        hits: [
          {
            projectKey: 'k',
            projectPath: 'D:/a',
            conversationId: 'c1',
            conversationTitle: 'T',
            messageId: 'm1',
            role: 'user',
            snippet: 'use pnpm',
          },
        ],
      },
      'pnpm'
    );
    expect(text).toContain('conversation_id: c1');
    expect(text).toContain('use pnpm');
    expect(text).toContain('offset=1');
  });

  it('supports offset paging within a conversation', () => {
    const conversations = [
      {
        id: 'c1',
        title: 'Thread',
        messages: [
          { id: 'm1', role: 'user', text: 'alpha pnpm one' },
          { id: 'm2', role: 'user', text: 'beta pnpm two' },
          { id: 'm3', role: 'user', text: 'gamma pnpm three' },
        ],
      },
    ];

    const page1 = searchMessagesInConversations(conversations, {
      terms: ['pnpm'],
      projectKey: 'key',
      projectPathFallback: 'D:/a',
      conversationId: 'c1',
      limit: 1,
      offset: 0,
    });
    expect(page1).toHaveLength(1);
    expect(page1[0]?.messageId).toBe('m1');

    const page2 = searchMessagesInConversations(conversations, {
      terms: ['pnpm'],
      projectKey: 'key',
      projectPathFallback: 'D:/a',
      conversationId: 'c1',
      limit: 1,
      offset: 1,
    });
    expect(page2).toHaveLength(1);
    expect(page2[0]?.messageId).toBe('m2');
  });
});
