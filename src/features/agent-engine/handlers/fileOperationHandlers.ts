import { invoke } from '@tauri-apps/api/core';

import type { FileInfo, ToolResult } from '../../../types/ai';
import { resolvePathWithBaseDir } from '../argsParser';
import { ToolError, handleToolError } from '../errors';
import type { ToolContext, ToolHandler } from '../types';
import type {
  CopyFileArgs,
  CreateFolderArgs,
  DeleteFileArgs,
  GetFileInfoArgs,
  MoveFileArgs,
} from '../toolArgs';

class CopyFileHandler implements ToolHandler<'copy_file'> {
  name = 'copy_file' as const;

  async execute(args: CopyFileArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.source) {
        throw ToolError.missingParam('source');
      }
      if (!args.destination) {
        throw ToolError.missingParam('destination');
      }

      const rootPath = context?.baseDir;
      if (!rootPath) {
        throw ToolError.directoryNotFound();
      }

      const resolvedSource = resolvePathWithBaseDir(args.source, rootPath);
      const resolvedDestination = resolvePathWithBaseDir(args.destination, rootPath);

      await invoke('copy_file_or_folder', {
        source: resolvedSource,
        destination: resolvedDestination,
        overwrite: args.overwrite ?? false,
        rootPath,
        opSource: 'ai',
      });

      return {
        tool_call_id: '',
        output: `成功将 ${resolvedSource} 复制到 ${resolvedDestination}`,
        files_changed: [resolvedDestination],
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class MoveFileHandler implements ToolHandler<'move_file'> {
  name = 'move_file' as const;

  async execute(args: MoveFileArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.source) {
        throw ToolError.missingParam('source');
      }
      if (!args.destination) {
        throw ToolError.missingParam('destination');
      }

      const rootPath = context?.baseDir;
      if (!rootPath) {
        throw ToolError.directoryNotFound();
      }

      const resolvedSource = resolvePathWithBaseDir(args.source, rootPath);
      const resolvedDestination = resolvePathWithBaseDir(args.destination, rootPath);

      await invoke('move_file_or_folder', {
        oldPath: resolvedSource,
        newPath: resolvedDestination,
        overwrite: args.overwrite ?? false,
        rootPath,
        opSource: 'ai',
      });

      return {
        tool_call_id: '',
        output: `成功将 ${resolvedSource} 移动到 ${resolvedDestination}`,
        files_changed: [resolvedSource, resolvedDestination],
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class DeleteFileHandler implements ToolHandler<'delete_file'> {
  name = 'delete_file' as const;

  async execute(args: DeleteFileArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.path) {
        throw ToolError.missingParam('path');
      }

      const rootPath = context?.baseDir;
      if (!rootPath) {
        throw ToolError.directoryNotFound();
      }

      const resolvedPath = resolvePathWithBaseDir(args.path, rootPath);
      const permanent = args.permanent ?? false;

      try {
        await invoke('delete_file_or_folder', {
          path: resolvedPath,
          permanent,
          rootPath,
          opSource: 'ai',
        });

        return {
          tool_call_id: '',
          output: permanent ? `已永久删除 ${resolvedPath}` : `已移入回收站: ${resolvedPath}`,
          files_changed: [resolvedPath],
        };
      } catch (invokeError) {
        const message = String(invokeError).toLowerCase();
        if (
          message.includes('路径不存在') ||
          message.includes('找不到') ||
          message.includes('not exist') ||
          message.includes('cannot find') ||
          message.includes('no such file')
        ) {
          return {
            tool_call_id: '',
            output: permanent
              ? `已永久删除（目标已不存在，视为成功）: ${resolvedPath}`
              : `已移入回收站（目标已不存在，视为成功）: ${resolvedPath}`,
          };
        }
        throw invokeError;
      }
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class CreateFolderHandler implements ToolHandler<'create_folder'> {
  name = 'create_folder' as const;

  async execute(args: CreateFolderArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.path) {
        throw ToolError.missingParam('path');
      }

      const resolvedPath = resolvePathWithBaseDir(args.path, context?.baseDir);
      await invoke('create_folder', { folderPath: resolvedPath, source: 'ai' });

      return {
        tool_call_id: '',
        output: `成功创建文件夹: ${resolvedPath}`,
        files_changed: [resolvedPath],
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class GetFileInfoHandler implements ToolHandler<'get_file_info'> {
  name = 'get_file_info' as const;

  async execute(args: GetFileInfoArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.path) {
        throw ToolError.missingParam('path');
      }

      const resolvedPath = resolvePathWithBaseDir(args.path, context?.baseDir);
      const info = await invoke<FileInfo>('get_file_info', { path: resolvedPath, source: 'ai' });

      if (!info.exists) {
        return {
          tool_call_id: '',
          output: '',
          error: `文件不存在: ${resolvedPath}`,
        };
      }

      const fileTypeLabels: Record<string, string> = {
        file: '文件',
        directory: '目录',
        symlink: '符号链接',
      };

      let output = `文件信息: ${info.path}\n\n`;
      output += `类型: ${fileTypeLabels[info.file_type] || info.file_type}\n`;

      if (info.target_path) {
        output += `指向: ${info.target_path}\n`;
      }

      if (info.file_type === 'file') {
        output += `大小: ${info.size_bytes.toLocaleString()} 字节 (${info.size_human})\n`;

        if (info.is_binary) {
          output += '文件类型: 二进制文件\n';
        }
      }

      if (info.created) {
        output += `创建时间: ${info.created}\n`;
      }
      if (info.modified) {
        output += `修改时间: ${info.modified}\n`;
      }
      if (info.accessed) {
        output += `访问时间: ${info.accessed}\n`;
      }

      output += `只读: ${info.is_readonly ? '是' : '否'}\n`;

      if (info.permissions) {
        output += `权限: ${info.permissions}\n`;
      }

      if (info.file_type === 'file') {
        if (info.is_binary) {
          output += '\n警告: 这是二进制文件，建议不要使用 read_file 直接读取内容。\n';
        } else if (info.size_bytes > 10_000_000) {
          output += `\n严重警告: 文件非常大 (${info.size_human})，直接读取会导致严重的 Token 消耗。\n`;
          output += '建议: 使用 read_file 的 max_bytes 或 max_lines 参数严格限制读取大小。\n';
        } else if (info.size_bytes > 1_000_000) {
          output += `\n注意: 文件较大 (${info.size_human})，直接读取可能消耗较多 Token。\n`;
        } else if (info.size_bytes < 100_000) {
          output += '\n提示: 文件较小，可以安全读取。\n';
        }
      }

      return { tool_call_id: '', output };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const fileOperationHandlers: ToolHandler[] = [
  new CopyFileHandler(),
  new MoveFileHandler(),
  new DeleteFileHandler(),
  new CreateFolderHandler(),
  new GetFileInfoHandler(),
];
