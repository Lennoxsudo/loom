import { describe, it, expect } from 'vitest';
import { normalizeToolArgs } from '../paramNormalizer';

describe('paramNormalizer', () => {
  describe('normalizeToolArgs', () => {
    it('should normalize path aliases', () => {
      const args = { filePath: '/test/file.txt' };
      const result = normalizeToolArgs(args);
      expect(result.path).toBe('/test/file.txt');
    });

    it('should not override existing canonical values', () => {
      const args = { path: '/original/path', filePath: '/other/path' };
      const result = normalizeToolArgs(args);
      expect(result.path).toBe('/original/path');
    });

    it('should normalize multiple aliases', () => {
      const args = {
        filePath: '/test/file.txt',
        terminalId: 'term-123',
        maxResults: 50,
      };
      const result = normalizeToolArgs(args);
      expect(result.path).toBe('/test/file.txt');
      expect(result.terminal_id).toBe('term-123');
      expect(result.max_results).toBe(50);
    });

    it('should preserve original args', () => {
      const args = { filePath: '/test', custom: 'value' };
      const result = normalizeToolArgs(args);
      expect(result.filePath).toBe('/test');
      expect(result.custom).toBe('value');
    });

    it('should handle empty args', () => {
      const result = normalizeToolArgs({});
      expect(result).toEqual({});
    });

    it('should handle tool-specific normalizations for read_file', () => {
      const args = { filePath: '/test/file.txt' };
      const result = normalizeToolArgs(args, 'read_file');
      expect(result.path).toBe('/test/file.txt');
    });

    it('should not map offset to start_line (graph_query pagination fix)', () => {
      // offset:0 must NOT be clobbered into start_line:0 (which Zod .positive() rejects)
      const result = normalizeToolArgs(
        { action: 'search', offset: 0, repo_path: 'D:/proj' },
        'graph_query'
      );
      expect(result.offset).toBe(0);
      expect(result.start_line).toBeUndefined();
    });

    it('should preserve offset as independent param for graph_query', () => {
      const result = normalizeToolArgs(
        { action: 'search', offset: 10, repo_path: 'D:/proj' },
        'graph_query'
      );
      expect(result.offset).toBe(10);
      expect(result.start_line).toBeUndefined();
    });

    it('maps code alias to pattern for graph_query action=code', () => {
      const result = normalizeToolArgs({ action: 'code', code: 'TODO' }, 'graph_query');
      expect(result.pattern).toBe('TODO');
    });

    it('maps cypher alias to query for graph_query action=query', () => {
      const result = normalizeToolArgs(
        { action: 'query', cypher: 'MATCH (n) RETURN n LIMIT 1' },
        'graph_query'
      );
      expect(result.query).toContain('MATCH');
    });

    it('preserves regex boolean for graph_query search (not pattern string)', () => {
      const result = normalizeToolArgs(
        { action: 'search', name_pattern: '.*Auth.*', regex: true, repo_path: 'D:/proj' },
        'graph_query'
      );
      expect(result.regex).toBe(true);
      expect(result.pattern).toBeUndefined();
      expect(result.name_pattern).toBe('.*Auth.*');
    });

    it('maps qualified_name to qn_pattern for graph_query search', () => {
      const result = normalizeToolArgs(
        {
          action: 'search',
          qualified_name: '.src.stores.products.getProductById',
          repo_path: 'D:/proj',
        },
        'graph_query'
      );
      expect(result.qn_pattern).toContain('getProductById');
      expect(result.qn_pattern).toContain('^');
    });

    it('coerces ask questions string into a one-item array with default options', () => {
      const result = normalizeToolArgs({ questions: '你更偏好 React 还是 Vue？' }, 'ask');
      expect(Array.isArray(result.questions)).toBe(true);
      const qs = result.questions as Array<Record<string, unknown>>;
      expect(qs).toHaveLength(1);
      expect(qs[0].question).toBe('你更偏好 React 还是 Vue？');
      expect(qs[0].header).toBeTruthy();
      expect(Array.isArray(qs[0].options)).toBe(true);
      expect((qs[0].options as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    it('parses ask questions JSON string and fills missing option descriptions', () => {
      const result = normalizeToolArgs(
        {
          questions: JSON.stringify([
            {
              header: '框架',
              question: '选哪个？',
              options: [{ label: 'React' }, { label: 'Vue' }],
            },
          ]),
        },
        'ask'
      );
      const qs = result.questions as Array<Record<string, unknown>>;
      expect(qs[0].header).toBe('框架');
      const opts = qs[0].options as Array<{ label: string; description: string }>;
      expect(opts).toHaveLength(2);
      expect(opts[0].description).toBe('React');
    });

    it('wraps a single ask question object into an array', () => {
      const result = normalizeToolArgs(
        {
          questions: {
            question: '是否继续？',
            options: ['是', '否'],
          },
        },
        'ask_user_question'
      );
      const qs = result.questions as Array<Record<string, unknown>>;
      expect(qs).toHaveLength(1);
      expect(qs[0].question).toBe('是否继续？');
      const opts = qs[0].options as Array<{ label: string }>;
      expect(opts.map((o) => o.label)).toEqual(['是', '否']);
    });
  });
});
