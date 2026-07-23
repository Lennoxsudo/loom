/**
 * 搜索处理器模块
 *
 * 本模块提供搜索相关工具的处理器实现：
 * - SearchFilesHandler: Glob 模式搜索文件
 * - SearchContentHandler: 搜索文件内容
 * - SearchBothHandler: 组合搜索（文件名 + 内容）
 * - ListDirectoryHandler: 列出目录内容
 * - GetFileTreeHandler: 获取文件树
 * - GetFileInfoHandler: 获取文件信息
 * - CreateFolderHandler: 创建文件夹
 *
 * @module aiTools/handlers/searchHandlers
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type {
  SearchFilesArgs,
  SearchContentArgs,
  ListDirectoryArgs,
  GetFileTreeArgs,
} from '../toolArgs';
import { ToolError, handleToolError } from '../errors';

import { invoke } from '@tauri-apps/api/core';
import type { FileTreeResult } from '../../../types/ai';
import { resolvePathWithBaseDir } from '../argsParser';

/** 匹配结果中的上下文行类型 */
type SearchMatchWithContext = {
  line: number;
  column?: number;
  preview: string;
  match_len?: number;
  context_before?: string[];
  context_after?: string[];
};

type SearchResultWithPath = {
  path: string;
  matches?: SearchMatchWithContext[];
};

/** Format search matches with context lines */
function formatMatchesWithContent(
  results: SearchResultWithPath[],
  query: string,
  showContext: boolean
): string {
  let output = `找到 ${results.length} 个文件包含 "${query}":\n\n`;

  for (const result of results) {
    output += `📄 ${result.path}\n`;
    if (result.matches && result.matches.length > 0) {
      const matchCount = result.matches.length;
      output += `   ${matchCount} 个匹配项\n`;

      for (let i = 0; i < Math.min(3, matchCount); i++) {
        const match = result.matches[i];

        // Context lines before
        if (showContext && match.context_before && match.context_before.length > 0) {
          for (let j = 0; j < match.context_before.length; j++) {
            const lineNum = match.line - match.context_before.length + j;
            output += `   │ ${lineNum}: ${match.context_before[j].trim()}\n`;
          }
        }

        output += `   - 第 ${match.line} 行: ${match.preview.trim()}\n`;

        // Context lines after
        if (showContext && match.context_after && match.context_after.length > 0) {
          for (let j = 0; j < match.context_after.length; j++) {
            const lineNum = match.line + j + 1;
            output += `   │ ${lineNum}: ${match.context_after[j].trim()}\n`;
          }
        }
      }

      if (matchCount > 3) {
        output += `   ... 还有 ${matchCount - 3} 个匹配项\n`;
      }
    }
    output += '\n';
  }

  return output;
}

/**
 * 搜索文件处理器（Glob 模式）
 */
class SearchFilesHandler implements ToolHandler<'search_files'> {
  name = 'search_files' as const;

  async execute(args: SearchFilesArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.pattern) {
        throw ToolError.missingParam('pattern');
      }

      const resolvedPath = args.folder_path
        ? resolvePathWithBaseDir(args.folder_path, context?.baseDir)
        : context?.baseDir;

      if (!resolvedPath) {
        throw ToolError.directoryNotFound();
      }

      const maxResults = args.max_results ?? 50;
      const pattern = args.pattern;
      const exclude = args.exclude || undefined;
      const maxDepth = args.max_depth ?? undefined;

      try {
        const results = await invoke<string[]>('glob_search_files', {
          rootPath: resolvedPath,
          pattern,
          maxResults,
          exclude,
          maxDepth,
          source: 'ai',
        });

        if (!results || results.length === 0) {
          return { tool_call_id: '', output: `未找到匹配 "${pattern}" 的文件` };
        }

        const limited = results.slice(0, 50);
        let output = `找到 ${results.length} 个匹配文件（最多展示 50 个）:\n\n`;
        output += limited.map((p) => `- ${p}`).join('\n');
        if (results.length > limited.length) {
          output += `\n... 还有 ${results.length - limited.length} 个未展示`;
        }

        return { tool_call_id: '', output };
      } catch (error) {
        throw new Error(`搜索文件失败: ${error}`, {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 搜索内容处理器 */
class SearchContentHandler implements ToolHandler<'search_content'> {
  name = 'search_content' as const;

  async execute(args: SearchContentArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.query) {
        throw ToolError.missingParam('query');
      }

      const resolvedPath = args.folder_path
        ? resolvePathWithBaseDir(args.folder_path, context?.baseDir)
        : context?.baseDir;

      if (!resolvedPath) {
        throw ToolError.missingParam('folder_path');
      }

      const query = args.query;
      const caseSensitive = args.case_sensitive ?? false;
      const useRegex = args.regex ?? false;
      const fileGlob = args.file_glob || undefined;
      const maxResults = args.max_results ?? 20;
      const exclude = args.exclude || undefined;
      const contextLines = args.context_lines ?? 0;

      try {
        const results = await invoke<SearchResultWithPath[]>('search_in_folder', {
          folderPath: resolvedPath,
          query,
          caseSensitive,
          maxResults,
          maxFileSize: 5_000_000,
          useRegex,
          fileGlob,
          exclude,
          contextLines,
          source: 'ai',
        });

        if (results.length === 0) {
          return { tool_call_id: '', output: `未找到包含 "${query}" 的文件` };
        }

        const output = formatMatchesWithContent(results, query, contextLines > 0);
        return { tool_call_id: '', output };
      } catch (error) {
        throw new Error(`搜索内容失败: ${error}`, {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 组合搜索处理器（文件名 + 内容） */
class SearchBothHandler implements ToolHandler<'search_both'> {
  name = 'search_both' as const;

  async execute(args: SearchContentArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const resolvedPath = args.folder_path
        ? resolvePathWithBaseDir(args.folder_path, context?.baseDir)
        : context?.baseDir;

      if (!resolvedPath) {
        throw ToolError.missingParam('folder_path');
      }

      const query = args.query ?? '';
      const pattern = ((args as Record<string, unknown>).pattern as string) ?? '';
      const searchQuery = query || pattern;

      if (!searchQuery) {
        throw ToolError.missingParam('query');
      }

      const caseSensitive = args.case_sensitive ?? false;
      const useRegex = args.regex ?? false;
      const fileGlob = args.file_glob || undefined;
      const maxResults = args.max_results ?? 20;
      const exclude = args.exclude || undefined;
      const contextLines = args.context_lines ?? 0;

      // Run both searches in parallel
      const [fileResults, contentResults] = await Promise.allSettled([
        invoke<string[]>('glob_search_files', {
          rootPath: resolvedPath,
          pattern: searchQuery,
          maxResults,
          exclude,
          source: 'ai',
        }),
        invoke<SearchResultWithPath[]>('search_in_folder', {
          folderPath: resolvedPath,
          query: searchQuery,
          caseSensitive,
          maxResults,
          maxFileSize: 5_000_000,
          useRegex,
          fileGlob,
          exclude,
          contextLines,
          source: 'ai',
        }),
      ]);

      const parts: string[] = [];

      // File name matches
      if (fileResults.status === 'fulfilled' && fileResults.value.length > 0) {
        const limited = fileResults.value.slice(0, 50);
        parts.push(
          `文件名匹配 (${fileResults.value.length} 个):\n${limited.map((p) => `- ${p}`).join('\n')}`
        );
        if (fileResults.value.length > limited.length) {
          parts[parts.length - 1] +=
            `\n... 还有 ${fileResults.value.length - limited.length} 个未展示`;
        }
      }

      // Content matches
      if (contentResults.status === 'fulfilled' && contentResults.value.length > 0) {
        parts.push(formatMatchesWithContent(contentResults.value, searchQuery, contextLines > 0));
      }

      if (parts.length === 0) {
        return { tool_call_id: '', output: `未找到匹配 "${searchQuery}" 的文件或内容` };
      }

      return { tool_call_id: '', output: parts.join('\n\n---\n\n') };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 列出目录处理器 */
class ListDirectoryHandler implements ToolHandler<'list_directory'> {
  name = 'list_directory' as const;

  async execute(args: ListDirectoryArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const listPath = args.path || context?.baseDir;
      if (!listPath) {
        return {
          tool_call_id: '',
          output: '',
          error: '请先打开一个文件夹后再列出目录，或在调用时指定 path 参数',
        };
      }

      const resolvedPath = resolvePathWithBaseDir(listPath, context?.baseDir);
      const dirsOnly = args.dirs_only === true;

      try {
        const nodes = await invoke<Array<{ name: string; is_dir: boolean }>>(
          'read_folder_children',
          { folderPath: resolvedPath, source: 'ai' }
        );

        if (!Array.isArray(nodes) || nodes.length === 0) {
          return {
            tool_call_id: '',
            output: `目录内容 (${resolvedPath}):\n\n(空目录 / 不存在 / 无权限)`,
          };
        }

        const filtered = dirsOnly ? nodes.filter((n) => n.is_dir) : nodes;
        const lines = filtered
          .map((n) => {
            const name = typeof n?.name === 'string' ? n.name : 'unknown';
            const isDir = !!n?.is_dir;
            return `${isDir ? '📁' : '📄'} ${name}`;
          })
          .join('\n');

        const filterNote = dirsOnly ? ' (仅目录)' : '';
        return { tool_call_id: '', output: `目录内容${filterNote} (${resolvedPath}):\n\n${lines}` };
      } catch (error) {
        throw new Error(`无法列出目录: ${error}`, {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 获取文件树处理器 */
class GetFileTreeHandler implements ToolHandler<'get_file_tree'> {
  name = 'get_file_tree' as const;

  async execute(args: GetFileTreeArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const resolvedPath = args.root_path
        ? resolvePathWithBaseDir(args.root_path, context?.baseDir)
        : context?.baseDir;

      if (!resolvedPath) {
        throw ToolError.directoryNotFound();
      }

      try {
        const maxDepth = args.max_depth ?? 3;
        const dirsOnly = args.dirs_only ?? false;
        const result = await invoke<FileTreeResult>('get_file_tree', {
          rootPath: resolvedPath,
          maxDepth,
          dirsOnly,
          source: 'ai',
        });

        return { tool_call_id: '', output: result.tree };
      } catch (error) {
        throw new Error(`无法获取文件树: ${error}`, {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const searchHandlers: ToolHandler[] = [
  new SearchFilesHandler(),
  new SearchContentHandler(),
  new SearchBothHandler(),
  new ListDirectoryHandler(),
  new GetFileTreeHandler(),
];
