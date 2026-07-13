/**
 * Git 处理器模块
 * 
 * 本模块提供 Git 相关工具的处理器实现：
 * - GetGitDiffHandler: 获取 Git Diff
 * - UndoChangesHandler: 撤销变更
 * - GetSymbolDefinitionHandler: 获取符号定义
 * 
 * @module aiTools/handlers/gitHandlers
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { GetGitDiffArgs, UndoChangesArgs, GetSymbolDefinitionArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { invoke } from '@tauri-apps/api/core';
import type { GitDiffResult, UndoChangesResult, SymbolDefinitionResult } from '../../../types/ai';
import { resolvePathWithBaseDir } from '../argsParser';

function getCodeFenceLanguage(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.vue')) return 'vue';
  if (normalized.endsWith('.tsx')) return 'tsx';
  if (normalized.endsWith('.jsx')) return 'jsx';
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return 'javascript';
  }
  return 'typescript';
}

/** 获取 Git Diff 处理器 */
class GetGitDiffHandler implements ToolHandler<'get_git_diff'> {
  name = 'get_git_diff' as const;

  async execute(args: GetGitDiffArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const repoPath = args.repo_path
        ? resolvePathWithBaseDir(args.repo_path, context?.baseDir)
        : context?.baseDir;

      if (!repoPath) {
        throw ToolError.directoryNotFound();
      }

      const options = {
        repo_path: repoPath,
        file_path: args.file_path,
        cached: args.cached,
        max_lines: args.max_lines,
      };

      try {
        const result = await invoke<GitDiffResult>('get_git_diff', { options });

        if (result.files.length === 0) {
          return { tool_call_id: '', output: options.cached ? '暂存区没有变更' : '工作区没有未暂存的变更' };
        }

        let output = `## Git Diff 摘要\n\n`;
        output += `**变更类型**: ${options.cached ? '暂存区' : '工作区 (未暂存)'}\n`;

        if (options.file_path) {
          output += `**文件**: ${options.file_path}\n`;
        }

        output += `\n**统计**:\n`;
        output += `- 变更文件: ${result.summary.total_files} 个\n`;
        output += `- 新增行数: +${result.summary.total_additions}\n`;
        output += `- 删除行数: -${result.summary.total_deletions}\n`;

        output += `\n**文件列表**:\n`;
        for (const file of result.files) {
          const statusEmoji =
            {
              modified: '📝',
              added: '✨',
              deleted: '🗑️',
              renamed: '📋',
            }[file.status] || '📄';

          const lockfileNote =
            file.path.includes('lock') && file.hunks.length === 0 ? ' (lockfile - 已过滤详情)' : '';

          output += `${statusEmoji} ${file.path} (+${file.additions} -${file.deletions})${lockfileNote}\n`;
        }

        if (result.truncated && result.truncated_info) {
          output += `\n⚠️ **截断警告**: ${result.truncated_info}\n`;
        }

        output += `\n---\n\n## 详细变更 (标准 Git Diff 格式)\n\n`;
        output += '```diff\n';
        output += result.raw_diff;
        output += '\n```\n';

        output += `\n---\n\n`;
        output += `💡 **使用建议**:\n`;
        output += `1. 使用此 diff 进行代码自查\n`;
        output += `2. 基于变更内容生成有意义的 commit message\n`;
        output += `3. 验证 edit_file 是否按预期工作\n`;

        if (result.truncated) {
          output += `4. 如需查看完整 diff，请使用 file_path 参数指定单个文件\n`;
        }

        return { tool_call_id: '', output };
      } catch (error) {
        throw new Error(`无法获取 Git Diff: ${error}`, { cause: error instanceof Error ? error : undefined });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 撤销变更处理器 */
class UndoChangesHandler implements ToolHandler<'undo_changes'> {
  name = 'undo_changes' as const;

  async execute(args: UndoChangesArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.file_paths || args.file_paths.length === 0) {
        throw ToolError.missingParam('file_paths');
      }

      const repoPath = args.repo_path
        ? resolvePathWithBaseDir(args.repo_path, context?.baseDir)
        : context?.baseDir;

      if (!repoPath) {
        throw ToolError.directoryNotFound();
      }

      const options = {
        repo_path: repoPath,
        file_paths: args.file_paths.map((p) =>
          resolvePathWithBaseDir(p, context?.baseDir)
        ),
      };

      try {
        const result = await invoke<UndoChangesResult>('undo_changes', { options });

        if (!result.success) {
          return { tool_call_id: '', output: `❌ 撤销失败: ${result.message}` };
        }

        let output = `## 撤销变更结果\n\n`;

        if (result.restored_files.length === 0) {
          output += `ℹ️ ${result.message}\n\n`;

          if (result.skipped_files.length > 0) {
            output += `**跳过的文件** (无变更):\n`;
            result.skipped_files.forEach((file) => {
              output += `  - ${file}\n`;
            });
          }

          output += `\n⚠️ **注意**: 此工具只能恢复已追踪文件的修改，无法删除新建的未追踪文件。\n`;
          output += `如需删除新建文件，请使用 delete_file 工具。\n`;

          return { tool_call_id: '', output };
        }

        output += `✅ ${result.message}\n\n`;

        output += `**已恢复的文件** (${result.restored_files.length} 个):\n`;
        result.restored_files.forEach((file) => {
          output += `  ✓ ${file}\n`;
        });

        if (result.skipped_files.length > 0) {
          output += `\n**跳过的文件** (${result.skipped_files.length} 个，无变更):\n`;
          result.skipped_files.forEach((file) => {
            output += `  - ${file}\n`;
          });
        }

        output += `\n---\n\n`;
        output += `💡 **提示**:\n`;
        output += `- 文件已恢复到最后一次 commit 的状态\n`;
        output += `- 此工具只恢复 MODIFIED/DELETED 文件，不删除 UNTRACKED 文件\n`;

        return { tool_call_id: '', output };
      } catch (invokeError) {
        const errorMsg = String(invokeError);
        if (errorMsg.includes('Not a git repository')) {
          throw new Error(`当前目录不是 Git 仓库: ${options.repo_path}`, { cause: invokeError instanceof Error ? invokeError : undefined });
        }
        if (
          errorMsg.includes('file_paths cannot be empty') ||
          errorMsg.includes('file_paths is empty')
        ) {
          throw new Error(`安全限制: 必须明确指定要恢复的文件路径，不能为空`, { cause: invokeError instanceof Error ? invokeError : undefined });
        }
        throw new Error(`撤销变更失败: ${invokeError}`, { cause: invokeError instanceof Error ? invokeError : undefined });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/** 获取代码诊断处理器 */
class GetSymbolDefinitionHandler implements ToolHandler<'sym'> {
  name = 'sym' as const;

  async execute(args: GetSymbolDefinitionArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.file_path) {
        throw ToolError.missingParam('file_path');
      }
      if (!args.symbol_name) {
        throw ToolError.missingParam('symbol_name');
      }

      const resolvedPath = resolvePathWithBaseDir(args.file_path, context?.baseDir);

      const options = {
        file_path: resolvedPath,
        symbol_name: args.symbol_name,
        line_number: args.line_number,
      };

      try {
        const result = await invoke<SymbolDefinitionResult>('get_symbol_definition', { options });

        const MAX_DEFINITION_CODE_CHARS = 12_000;
        let definitionCode = result.definition_code ?? '';
        if (definitionCode.length > MAX_DEFINITION_CODE_CHARS) {
          definitionCode =
            definitionCode.slice(0, MAX_DEFINITION_CODE_CHARS) +
            '\n... (truncated; use read_file to view the full file)';
        }

        let output = `## 符号定义: ${result.symbol_name}\n\n`;

        output += `**定义文件**: ${result.definition_file}:${result.definition_line}\n`;
        output += `**定义类型**: ${result.definition_type}\n`;
        output += `**导入来源**: ${result.import_source}\n`;

        output += `\n### 定义代码\n\n`;
        output += `\`\`\`${getCodeFenceLanguage(result.definition_file)}\n`;
        output += definitionCode;
        output += '\n```\n';

        output += `\n---\n\n`;
        output += `💡 **提示**:\n`;
        output += `- 使用 read_file 工具可以查看完整文件内容\n`;

        return { tool_call_id: '', output };
      } catch (error) {
        const errorMsg = String(error);

        if (errorMsg.includes('Symbol not found in imports')) {
          throw new Error(`未找到符号 "${options.symbol_name}" 的导入语句。`, { cause: error instanceof Error ? error : undefined });
        }

        if (errorMsg.includes('File not found') || errorMsg.includes('No such file')) {
          throw new Error(`文件不存在: ${options.file_path}`, { cause: error instanceof Error ? error : undefined });
        }

        if (
          errorMsg.toLowerCase().includes('permission denied') ||
          errorMsg.toLowerCase().includes('access is denied') ||
          errorMsg.includes('权限') ||
          errorMsg.includes('拒绝访问')
        ) {
          throw new Error(
            `无法读取文件（权限不足）: ${options.file_path}。请确认该文件在已打开的工作区内且当前用户有读取权限。`,
            { cause: error instanceof Error ? error : undefined }
          );
        }

        throw new Error(`查找符号定义失败: ${error}`, { cause: error instanceof Error ? error : undefined });
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const gitHandlers: ToolHandler[] = [
  new GetGitDiffHandler(),
  new UndoChangesHandler(),
  new GetSymbolDefinitionHandler(),
];
