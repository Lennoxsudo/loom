import { invoke } from '@tauri-apps/api/core';

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { ReadFileArgs, EditFileArgs, WriteFileArgs } from '../toolArgs';
import { ToolError, ToolErrorCode, handleToolError } from '../errors';
import { resolvePathWithBaseDir } from '../argsParser';
import type { ReadFileToolResult, WriteFileResult } from '../../../types/ai';

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export class ReadFileHandler implements ToolHandler<'read'> {
  name = 'read' as const;

  validate(args: unknown): args is ReadFileArgs {
    return typeof args === 'object' && args !== null && 'path' in args;
  }

  async execute(args: ReadFileArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.path) {
        throw new ToolError(
          ToolErrorCode.MISSING_PARAM,
          '缺少必需参数: path。请重新调用 read_file，并显式传入 {"path":"src/App.tsx"}。',
          false
        );
      }

      // Support batch reading: path can be a string or array of strings
      const paths = Array.isArray(args.path) ? args.path : [args.path];
      const results: string[] = [];

      for (const singlePath of paths) {
        const resolvedPath = resolvePathWithBaseDir(singlePath, context?.baseDir);

        const readArgs = {
          filePath: resolvedPath,
          startLine: asNumber(args.start_line),
          maxLines: asNumber(args.max_lines) ?? 2000,
          maxBytes: asNumber(args.max_bytes) ?? 200_000,
          encoding: args.encoding,
          search: args.search,
          aroundLine: asNumber(args.around_line),
        };

        const result = await invoke<ReadFileToolResult>('read_file_content_tool', {
          req: readArgs,
          source: 'ai',
        });

        if (result.is_binary) {
          if (result.binary_info) {
            const info = result.binary_info;
            results.push(
              `文件是二进制: ${resolvedPath}\n` +
                `类型: ${info.mime_type}\n` +
                `大小: ${info.size_bytes} bytes` +
                (info.width && info.height ? `\n尺寸: ${info.width}x${info.height}` : '')
            );
          } else {
            results.push(`文件是二进制或不可读: ${resolvedPath}`);
          }
          continue;
        }

        let output = result.content;
        if (result.truncated) {
          output += `\n(已截断: ${result.lines_read} 行 / ${result.bytes_read} 字节)`;
        }
        if (result.encoding_used && result.encoding_used !== 'utf-8') {
          output += `\n[编码: ${result.encoding_used}]`;
        }
        if (result.total_lines) {
          output += `\n[文件总行数: ${result.total_lines}]`;
        }

        results.push(`文件内容 (${resolvedPath}):\n\n\`\`\`\n${output}\n\`\`\``);
      }

      return { tool_call_id: '', output: results.join('\n\n---\n\n') };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export class EditFileHandler implements ToolHandler<'edit'> {
  name = 'edit' as const;

  validate(args: unknown): args is EditFileArgs {
    return (
      typeof args === 'object' &&
      args !== null &&
      'path' in args &&
      'old_string' in args &&
      'new_string' in args
    );
  }

  async execute(args: EditFileArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.path) {
        throw ToolError.missingParam('path');
      }
      if (!args.old_string) {
        throw ToolError.missingParam('old_string');
      }
      if (typeof args.new_string !== 'string') {
        throw ToolError.missingParam('new_string');
      }

      const resolvedPath = resolvePathWithBaseDir(args.path, context?.baseDir);

      const oldString = args.old_string;
      const newString = args.new_string;
      const replaceAll = typeof args.replace_all === 'boolean' ? args.replace_all : false;

      // Try replacing precisely via the backend string modification
      const tryEdit = async (oldStr: string, newStr: string) => {
        return await invoke<{ success: boolean; summary: string }>('edit_file', {
          req: {
            filePath: resolvedPath,
            oldString: oldStr,
            newString: newStr,
            replaceAll,
          },
          source: 'ai',
        });
      };

      try {
        const result = await tryEdit(oldString, newString);
        if (result.success) {
          // 严格验证：读回文件，确认 new_string 存在且 old_string 不再存在
          try {
            const verifyContent = await invoke<string>('read_file_content', {
              filePath: resolvedPath,
            });
            const verifyNorm = verifyContent.replace(/\r\n/g, '\n');
            const newNorm = newString.replace(/\r\n/g, '\n');
            const oldNorm = oldString.replace(/\r\n/g, '\n');
            const newStringPresent = !newNorm || verifyNorm.includes(newNorm);
            const oldStringGone = !verifyNorm.includes(oldNorm);
            if (!newStringPresent || !oldStringGone) {
              console.warn(
                '[EditFileHandler] 写入验证异常:',
                resolvedPath,
                'new存在:',
                newStringPresent,
                'old消失:',
                oldStringGone
              );
            }
          } catch {
            // 验证失败不影响返回结果
          }
          return {
            tool_call_id: '',
            output: result.summary,
            files_changed: [resolvedPath],
          };
        }

        const normalizeNewlines = (input: string) => input.replace(/\r\n/g, '\n');
        const normalizeTrailingWhitespacePerLine = (input: string) =>
          input
            .split('\n')
            .map((line) => line.replace(/[\t\x20]+$/g, ''))
            .join('\n');

        const normalizedOld = normalizeTrailingWhitespacePerLine(normalizeNewlines(oldString));
        const normalizedNew = normalizeTrailingWhitespacePerLine(normalizeNewlines(newString));

        if (normalizedOld !== oldString || normalizedNew !== newString) {
          const retry = await tryEdit(normalizedOld, normalizedNew);
          if (retry.success) {
            return {
              tool_call_id: '',
              output: `${retry.summary}\n(已自动处理换行符/行尾空白差异后重试成功)`,
              files_changed: [resolvedPath],
            };
          }
        }

        // If both strict and normalized edits failed on the backend, return a descriptive error
        const oldSnippet = oldString.slice(0, 200).replace(/\n/g, '\\n');
        const errorMsg =
          `编辑失败: old_string 未在文件中找到。\n\n` +
          `- 文件: ${resolvedPath}\n` +
          `- replace_all: ${replaceAll}\n` +
          `- old_string 预览:\n\n${oldSnippet}`;
        return {
          tool_call_id: '',
          output: errorMsg,
          error: errorMsg,
        };
      } catch (error) {
        throw ToolError.fileEditError(resolvedPath, String(error));
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class WriteFileHandler implements ToolHandler<'write'> {
  name = 'write' as const;

  validate(args: unknown): args is WriteFileArgs {
    return typeof args === 'object' && args !== null && 'path' in args && 'content' in args;
  }

  async execute(args: WriteFileArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.path) {
        throw ToolError.missingParam('path');
      }
      if (typeof args.content !== 'string') {
        throw ToolError.missingParam('content');
      }

      const resolvedPath = resolvePathWithBaseDir(args.path, context?.baseDir);

      const isAppend = typeof args.append === 'boolean' ? args.append : false;
      const isPrepend = typeof args.prepend === 'boolean' ? args.prepend : false;

      // 直接写入文件，由后端处理路径校验和错误
      const result = await invoke<WriteFileResult>('write_file_content', {
        filePath: resolvedPath,
        content: args.content,
        append: isAppend,
        prepend: isPrepend,
        ifNotExists: args.if_not_exists ?? false,
        templateVars: args.template_vars,
        source: 'ai',
      });

      // if_not_exists 跳过写入
      if (result.skipped) {
        return {
          tool_call_id: '',
          output: `文件 ${resolvedPath} 已存在，因 if_not_exists=true 跳过写入。`,
          files_changed: [],
        };
      }

      // 验证文件是否真正写入磁盘 (skip verify for append/prepend mode — partial content check)
      if (!isAppend && !isPrepend) {
        try {
          const verifyContent = await invoke<string>('read_file_content', {
            filePath: resolvedPath,
          });
          const writeNorm = args.content.replace(/\r\n/g, '\n');
          const readNorm = verifyContent.replace(/\r\n/g, '\n');
          if (writeNorm !== readNorm) {
            console.error('[WriteFileHandler] 写入验证失败! 文件内容与预期不符', resolvedPath);
          }
        } catch (verifyError) {
          console.warn('[WriteFileHandler] 写入后无法读取验证:', verifyError);
        }
      }

      // Build output message
      let mode = '写入';
      if (isAppend) mode = '追加';
      else if (isPrepend) mode = '头部插入';

      let output = `已${mode}文件 ${resolvedPath}，${result.bytes_written} 字节`;

      // Always show lines if available
      if (result.lines !== undefined && result.lines !== null) {
        output += `，${result.lines} 行`;
      }

      // Duration for larger files
      if (
        result.duration_ms !== undefined &&
        result.duration_ms !== null &&
        result.duration_ms > 0
      ) {
        output += `，耗时 ${result.duration_ms}ms`;
      }

      output += '。';

      return {
        tool_call_id: '',
        output,
        files_changed: [resolvedPath],
      };
    } catch (error) {
      console.error('[WriteFileHandler] 写入失败:', error);
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const fileHandlers: ToolHandler[] = [
  new ReadFileHandler(),
  new EditFileHandler(),
  new WriteFileHandler(),
];
