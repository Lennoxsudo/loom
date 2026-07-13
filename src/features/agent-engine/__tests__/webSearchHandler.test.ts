import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolHandler } from '../registry';
import { invoke } from '@tauri-apps/api/core';
import { normalizeToolArgs } from '../paramNormalizer';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('WebSearchHandler', () => {
  const handler = getToolHandler('web_search');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is registered', () => {
    expect(handler).toBeDefined();
    expect(handler?.name).toBe('web_search');
  });

  it('returns error when query is missing', async () => {
    const result = await handler!.execute({} as { query: string });
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/query|缺少/i);
  });

  it('formats successful search results for context', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      query: 'rust async',
      count: 2,
      provider: 'duckduckgo',
      results: [
        {
          title: 'Async book',
          url: 'https://rust-lang.github.io/async-book/',
          snippet: 'Asynchronous Programming in Rust',
        },
        {
          title: 'Tokio',
          url: 'https://tokio.rs/',
          snippet: 'Runtime for async Rust',
        },
      ],
    });

    const result = await handler!.execute({ query: 'rust async', num_results: 5 });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('搜索: "rust async"');
    expect(result.output).toContain('1. Async book');
    expect(result.output).toContain('https://rust-lang.github.io/async-book/');
    expect(result.output).toContain('摘要: Asynchronous Programming in Rust');
    expect(result.output).toContain('2. Tokio');
    expect(invoke).toHaveBeenCalledWith('web_search', {
      query: 'rust async',
      numResults: 5,
    });
  });

  it('formats empty results', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      query: 'xyznonexistent',
      count: 0,
      provider: 'duckduckgo',
      results: [],
    });

    const result = await handler!.execute({ query: 'xyznonexistent' });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('结果: 0');
    expect(result.output).toContain('未找到');
  });

  it('surfaces invoke failures', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('network down'));
    const result = await handler!.execute({ query: 'test' });
    expect(result.error).toContain('搜索失败');
  });
});

describe('web_search arg normalization', () => {
  it('maps max_results and limit to num_results', () => {
    const a = normalizeToolArgs({ query: 'q', max_results: 3 }, 'web_search');
    expect(a.num_results).toBe(3);

    const b = normalizeToolArgs({ q: 'hello', limit: 7 }, 'web_search');
    expect(b.query).toBe('hello');
    expect(b.num_results).toBe(7);
  });
});
