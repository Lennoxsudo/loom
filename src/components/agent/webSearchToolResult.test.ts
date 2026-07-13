import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  extractHost,
  formatResultUrl,
  parseWebSearchToolResult,
} from './webSearchToolResult';

const SAMPLE_OUTPUT =
  '搜索: "React 19"\n结果: 2（来源: duckduckgo）\n\n' +
  '1. React\n   URL: https://react.dev/\n   摘要: The library for web UIs\n\n' +
  '2. React Blog\n   URL: https://react.dev/blog\n   摘要: Latest updates\n\n' +
  '提示: 需要完整页面内容时，对感兴趣的 URL 使用 fetch 工具。';

describe('parseWebSearchToolResult', () => {
  it('parses query, count, provider, results, and hint', () => {
    const view = parseWebSearchToolResult(SAMPLE_OUTPUT);

    expect(view.isError).toBe(false);
    expect(view.query).toBe('React 19');
    expect(view.count).toBe(2);
    expect(view.provider).toBe('duckduckgo');
    expect(view.results).toHaveLength(2);
    expect(view.results[0]).toEqual({
      title: 'React',
      url: 'https://react.dev/',
      snippet: 'The library for web UIs',
    });
    expect(view.hint).toContain('fetch');
  });

  it('parses empty results with message', () => {
    const view = parseWebSearchToolResult(
      '搜索: "xyz"\n结果: 0\n\n未找到相关结果。可改用更具体的关键词。',
    );

    expect(view.isError).toBe(false);
    expect(view.count).toBe(0);
    expect(view.results).toHaveLength(0);
    expect(view.emptyMessage).toContain('未找到');
  });

  it('returns error view for failed searches', () => {
    const view = parseWebSearchToolResult('搜索失败: network down', true);

    expect(view.isError).toBe(true);
    expect(view.errorText).toContain('network down');
    expect(view.results).toHaveLength(0);
  });

  it('detects error patterns without explicit flag', () => {
    const view = parseWebSearchToolResult('❌ 错误: timeout');

    expect(view.isError).toBe(true);
    expect(view.errorText).toContain('timeout');
  });

  it('decodes HTML entities in titles and snippets', () => {
    const view = parseWebSearchToolResult(
      '搜索: "t"\n结果: 1（来源: bing）\n\n' +
      '1. Title&ensp;here\n   URL: https://example.com/\n   摘要: Snip&ensp;pet&#0183;',
    );

    expect(view.results[0]?.title).toBe('Title here');
    expect(view.results[0]?.snippet).toContain('Snip pet');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    const decoded = decodeHtmlEntities('a&ensp;b&#0183;c');
    expect(decoded).not.toContain('&ensp;');
    expect(decoded).toContain('·');
  });
});

describe('formatResultUrl', () => {
  it('compacts host and path', () => {
    expect(formatResultUrl('https://react.dev/blog/2024')).toBe('react.dev/blog/2024');
  });
});

describe('extractHost', () => {
  it('extracts hostname from URL', () => {
    expect(extractHost('https://react.dev/docs')).toBe('react.dev');
  });

  it('includes port when present', () => {
    expect(extractHost('http://localhost:3000/path')).toBe('localhost:3000');
  });
});
