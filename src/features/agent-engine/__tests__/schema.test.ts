/**
 * Unit tests for tool parameter schema validation
 */

import { describe, it, expect } from 'vitest';
import { validateToolParameters } from '../schema';
import { normalizeToolArgs } from '../paramNormalizer';

describe('schema validation', () => {
  describe('validateToolParameters', () => {
    it('should validate terminal tool parameters correctly', () => {
      // Valid terminal parameters
      const validTerminal = {
        action: 'run',
        command: 'ls -la',
        working_dir: '/home/user',
        timeout: 30000,
        description: 'List files',
      };
      
      const result1 = validateToolParameters('terminal', validTerminal);
      expect(result1.success).toBe(true);
      expect(result1.success ? result1.data : null).toEqual(validTerminal);

      // Invalid terminal parameters (missing command for 'run' action)
      const invalidTerminal = {
        action: 'run',
        working_dir: '/home/user',
      };
      
      const result2 = validateToolParameters('terminal', invalidTerminal);
      expect(result2.success).toBe(false);
      expect(result2.success ? null : result2.error).toContain('Validation failed');
    });

    it('should validate edit_file tool parameters correctly', () => {
      // Valid edit_file parameters
      const validEdit = {
        path: '/test/file.txt',
        old_string: 'old content',
        new_string: 'new content',
        replace_all: true,
      };
      
      const result1 = validateToolParameters('edit_file', validEdit);
      expect(result1.success).toBe(true);
      expect(result1.success ? result1.data : null).toEqual(validEdit);

      // Invalid edit_file parameters (empty old_string)
      const invalidEdit = {
        path: '/test/file.txt',
        old_string: '   ',
        new_string: 'new content',
      };
      
      const result2 = validateToolParameters('edit_file', invalidEdit);
      expect(result2.success).toBe(false);
      expect(result2.success ? null : result2.error).toContain('Validation failed');
    });

    it('should validate read_file tool parameters correctly', () => {
      // Valid read_file parameters
      const validRead = {
        path: '/test/file.txt',
        start_line: 10,
        max_lines: 50,
      };
      
      const result = validateToolParameters('read_file', validRead);
      expect(result.success).toBe(true);
      expect(result.success ? result.data : null).toEqual(validRead);

      // Invalid read_file parameters (negative start_line)
      const invalidRead = {
        path: '/test/file.txt',
        start_line: -1,
      };
      
      const result2 = validateToolParameters('read_file', invalidRead);
      expect(result2.success).toBe(false);
    });

    it('should validate write_file tool parameters correctly', () => {
      // Valid write_file parameters
      const validWrite = {
        path: '/test/file.txt',
        content: 'file content',
      };
      
      const result = validateToolParameters('write_file', validWrite);
      expect(result.success).toBe(true);

      // Invalid write_file parameters (missing content)
      const invalidWrite = {
        path: '/test/file.txt',
      };
      
      const result2 = validateToolParameters('write_file', invalidWrite);
      expect(result2.success).toBe(false);
    });

    it('should validate control_browser tool parameters correctly', () => {
      // Valid control_browser parameters for 'open'
      const validBrowserOpen = {
        action: 'open',
        url: 'https://example.com',
        title: 'Example',
      };
      
      const result1 = validateToolParameters('control_browser', validBrowserOpen);
      expect(result1.success).toBe(true);

      // Valid control_browser parameters for 'close' (no URL needed)
      const validBrowserClose = {
        action: 'close',
      };
      
      const result2 = validateToolParameters('control_browser', validBrowserClose);
      expect(result2.success).toBe(true);

      // Invalid control_browser parameters (missing URL for 'open')
      const invalidBrowser = {
        action: 'open',
        title: 'Example',
      };
      
      const result3 = validateToolParameters('control_browser', invalidBrowser);
      expect(result3.success).toBe(false);
      expect(result3.success ? null : result3.error).toContain('Validation failed');
    });

    it('should validate fetch_web_content tool parameters correctly', () => {
      // Valid fetch_web_content parameters
      const validFetch = {
        url: 'https://example.com',
      };
      
      const result1 = validateToolParameters('fetch_web_content', validFetch);
      expect(result1.success).toBe(true);

      // Invalid fetch_web_content parameters (invalid URL)
      const invalidFetch = {
        url: 'not-a-url',
      };
      
      const result2 = validateToolParameters('fetch_web_content', invalidFetch);
      expect(result2.success).toBe(false);
    });

    it('should validate web_search tool parameters correctly', () => {
      const validSearch = {
        query: 'React 19 changelog',
        num_results: 5,
      };
      const result1 = validateToolParameters('web_search', validSearch);
      expect(result1.success).toBe(true);

      const missingQuery = { num_results: 3 };
      const result2 = validateToolParameters('web_search', missingQuery);
      expect(result2.success).toBe(false);

      const tooMany = { query: 'foo', num_results: 50 };
      const result3 = validateToolParameters('web_search', tooMany);
      expect(result3.success).toBe(false);
    });

    it('should validate ask_user_question tool parameters correctly', () => {
      // Valid ask_user_question parameters
      const validQuestion = {
        questions: [
          {
            header: 'Question',
            question: 'What is your name?',
            options: [
              { label: 'Option 1', description: 'First option' },
              { label: 'Option 2', description: 'Second option' },
            ],
            multiSelect: false,
          },
        ],
      };
      
      const result1 = validateToolParameters('ask_user_question', validQuestion);
      expect(result1.success).toBe(true);

      // Invalid ask_user_question parameters (empty questions array)
      const invalidQuestion = {
        questions: [],
      };
      
      const result2 = validateToolParameters('ask_user_question', invalidQuestion);
      expect(result2.success).toBe(false);
    });

    it('should validate TodoWrite tool parameters correctly', () => {
      // Valid TodoWrite parameters
      const validTodo = {
        todos: [
          {
            content: 'Task 1',
            status: 'pending',
            priority: 'high',
          },
          {
            content: 'Task 2',
            status: 'in_progress',
            priority: 'medium',
          },
        ],
      };
      
      const result1 = validateToolParameters('TodoWrite', validTodo);
      expect(result1.success).toBe(true);

      // Invalid TodoWrite parameters (empty todos array)
      const invalidTodo = {
        todos: [],
      };
      
      const result2 = validateToolParameters('TodoWrite', invalidTodo);
      expect(result2.success).toBe(false);
    });

    it('should handle unknown tool with base validation', () => {
      // Unknown tool should use base schema validation
      const params = {
        path: '/test/file.txt',
        timeout: 5000,
      };
      
      const result = validateToolParameters('unknown_tool', params);
      expect(result.success).toBe(true);
      expect(result.success ? result.data : null).toEqual(params);
    });

    it('should reject invalid parameter types', () => {
      // Invalid type for timeout (string instead of number)
      const invalidParams = {
        action: 'run',
        command: 'ls',
        timeout: '5000', // string, should be number
      };
      
      const result = validateToolParameters('terminal', invalidParams);
      expect(result.success).toBe(false);
    });

    it('should reject out-of-range values', () => {
      // Timeout too large (max is 600000)
      const invalidParams = {
        action: 'run',
        command: 'ls',
        timeout: 1000000, // exceeds max
      };
      
      const result = validateToolParameters('terminal', invalidParams);
      expect(result.success).toBe(false);
    });
  });

  describe('graph tools', () => {
    it('validates graph_query query action', () => {
      const result = validateToolParameters('graph_query', {
        action: 'query',
        repo_path: 'D:/proj',
        query: 'MATCH (f:Function) RETURN f LIMIT 5',
      });
      expect(result.success).toBe(true);
    });

    it('rejects graph_query query without query string', () => {
      const result = validateToolParameters('graph_query', {
        action: 'query',
        repo_path: 'D:/proj',
      });
      expect(result.success).toBe(false);
    });

    it('allows graph_query snippet with name_pattern only', () => {
      const result = validateToolParameters('graph_query', {
        action: 'snippet',
        name_pattern: 'MyClass',
        repo_path: 'D:/proj',
      });
      expect(result.success).toBe(true);
    });

    it('rejects graph_query snippet without qualified_name or name_pattern', () => {
      const result = validateToolParameters('graph_query', {
        action: 'snippet',
        repo_path: 'D:/proj',
      });
      expect(result.success).toBe(false);
    });

    it('validates graph_query schema action', () => {
      const result = validateToolParameters('graph_query', { action: 'schema' });
      expect(result.success).toBe(true);
    });

    it('validates graph_query list action', () => {
      const result = validateToolParameters('graph_query', { action: 'list' });
      expect(result.success).toBe(true);
    });

    it('validates graph_query code action with pattern', () => {
      const result = validateToolParameters('graph_query', { action: 'code', pattern: 'TODO' });
      expect(result.success).toBe(true);
    });

    it('rejects graph_query code without pattern', () => {
      const result = validateToolParameters('graph_query', { action: 'code' });
      expect(result.success).toBe(false);
    });

    it('allows graph_query search with regex boolean after normalize', () => {
      const normalized = normalizeToolArgs(
        { action: 'search', name_pattern: '.*Auth.*', regex: true, repo_path: 'D:/proj' },
        'graph_query',
      );
      const result = validateToolParameters('graph_query', normalized);
      expect(result.success).toBe(true);
    });

    it('validates graph_trace changes action', () => {
      const result = validateToolParameters('graph_trace', {
        action: 'changes',
        repo_path: 'D:/proj',
      });
      expect(result.success).toBe(true);
    });

    it('rejects graph_index index without repo_path', () => {
      const result = validateToolParameters('graph_index', { action: 'index' });
      expect(result.success).toBe(false);
    });

    it('allows graph_index index with project instead of repo_path', () => {
      const result = validateToolParameters('graph_index', {
        action: 'index',
        project: 'my-project-slug',
      });
      expect(result.success).toBe(true);
    });

    it('allows graph_index list without repo_path', () => {
      const result = validateToolParameters('graph_index', { action: 'list' });
      expect(result.success).toBe(true);
    });

    it('allows graph_index status without repo_path when project is set', () => {
      const result = validateToolParameters('graph_index', {
        action: 'status',
        project: 'D-project-foo',
      });
      expect(result.success).toBe(true);
    });
  });
});
