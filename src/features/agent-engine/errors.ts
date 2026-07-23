/**
 * AI 工具系统错误处理模块
 *
 * 本模块提供了统一的错误处理机制，包括：
 * - ToolErrorCode: 错误代码枚举
 * - ToolError: 统一错误类
 * - ERROR_SUGGESTIONS: 错误恢复建议
 *
 * 所有工具处理器都应该使用 ToolError 来报告错误，
 * 以确保错误信息的一致性和可恢复性。
 *
 * @module aiTools/errors
 *
 * @example
 * ```typescript
 * // 创建参数缺失错误
 * throw ToolError.missingParam('path');
 *
 * // 创建文件未找到错误
 * throw ToolError.fileNotFound('/test/file.txt');
 *
 * // 处理错误
 * try {
 *   await handler.execute(args);
 * } catch (error) {
 *   if (isToolError(error)) {
 *     return error.toToolResult(toolCallId);
 *   }
 * }
 * ```
 */

export enum ToolErrorCode {
  MISSING_PARAM = 'MISSING_PARAM',
  INVALID_PARAM = 'INVALID_PARAM',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  FILE_EDIT_ERROR = 'FILE_EDIT_ERROR',
  FILE_DELETE_ERROR = 'FILE_DELETE_ERROR',
  FILE_MOVE_ERROR = 'FILE_MOVE_ERROR',
  DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',
  SEARCH_ERROR = 'SEARCH_ERROR',
  TERMINAL_ERROR = 'TERMINAL_ERROR',
  COMMAND_ERROR = 'COMMAND_ERROR',
  GIT_ERROR = 'GIT_ERROR',
  BROWSER_ERROR = 'BROWSER_ERROR',

  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export const ERROR_SUGGESTIONS: Record<ToolErrorCode, string> = {
  [ToolErrorCode.MISSING_PARAM]: '请检查工具调用参数是否完整',
  [ToolErrorCode.INVALID_PARAM]: '请检查参数格式是否正确',
  [ToolErrorCode.FILE_NOT_FOUND]: '请确认文件路径是否正确，或使用 search_files 搜索文件',
  [ToolErrorCode.FILE_READ_ERROR]: '请检查文件是否存在且有读取权限',
  [ToolErrorCode.FILE_WRITE_ERROR]: '请检查文件路径是否有效且有写入权限',
  [ToolErrorCode.FILE_EDIT_ERROR]: '请确认 old_string 内容在文件中存在',
  [ToolErrorCode.FILE_DELETE_ERROR]: '请检查文件是否存在且有删除权限',
  [ToolErrorCode.FILE_MOVE_ERROR]: '请检查源文件和目标路径是否有效',
  [ToolErrorCode.DIRECTORY_NOT_FOUND]: '请先打开一个文件夹后再执行此操作',
  [ToolErrorCode.SEARCH_ERROR]: '请检查搜索路径和模式是否正确',
  [ToolErrorCode.TERMINAL_ERROR]: '请检查终端是否正常创建',
  [ToolErrorCode.COMMAND_ERROR]: '请检查命令格式是否正确',
  [ToolErrorCode.GIT_ERROR]: '请确认当前目录是 Git 仓库',
  [ToolErrorCode.BROWSER_ERROR]: '请检查浏览器是否正常启动',

  [ToolErrorCode.PERMISSION_DENIED]: '请检查是否有足够的权限执行此操作',
  [ToolErrorCode.RESOURCE_LIMIT]: '已达到资源限制，请减少操作范围',
  [ToolErrorCode.UNKNOWN_ERROR]: '请重试或联系支持',
};

export class ToolError extends Error {
  public readonly code: ToolErrorCode;
  public readonly recoverable: boolean;
  public readonly suggestion: string;

  constructor(code: ToolErrorCode, message: string, recoverable: boolean = true) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.recoverable = recoverable;
    this.suggestion = ERROR_SUGGESTIONS[code];

    Object.setPrototypeOf(this, ToolError.prototype);
  }

  static missingParam(paramName: string): ToolError {
    return new ToolError(ToolErrorCode.MISSING_PARAM, `缺少必需参数: ${paramName}`, false);
  }

  static invalidParam(paramName: string, reason?: string): ToolError {
    const message = reason ? `参数无效: ${paramName} - ${reason}` : `参数无效: ${paramName}`;
    return new ToolError(ToolErrorCode.INVALID_PARAM, message, true);
  }

  static fileNotFound(path: string): ToolError {
    return new ToolError(ToolErrorCode.FILE_NOT_FOUND, `文件不存在: ${path}`, true);
  }

  static directoryNotFound(): ToolError {
    return new ToolError(
      ToolErrorCode.DIRECTORY_NOT_FOUND,
      '请先打开一个文件夹后再执行此操作',
      true
    );
  }

  static fileReadError(path: string, reason?: string): ToolError {
    const message = reason ? `无法读取文件 ${path}: ${reason}` : `无法读取文件: ${path}`;
    return new ToolError(ToolErrorCode.FILE_READ_ERROR, message, true);
  }

  static fileWriteError(path: string, reason?: string): ToolError {
    const message = reason ? `无法写入文件 ${path}: ${reason}` : `无法写入文件: ${path}`;
    return new ToolError(ToolErrorCode.FILE_WRITE_ERROR, message, true);
  }

  static fileEditError(path: string, reason?: string): ToolError {
    const message = reason ? `无法编辑文件 ${path}: ${reason}` : `无法编辑文件: ${path}`;
    return new ToolError(ToolErrorCode.FILE_EDIT_ERROR, message, true);
  }

  static terminalError(reason?: string): ToolError {
    const message = reason ? `终端错误: ${reason}` : '终端操作失败';
    return new ToolError(ToolErrorCode.TERMINAL_ERROR, message, true);
  }

  static commandError(command: string, reason?: string): ToolError {
    const message = reason ? `命令执行失败 "${command}": ${reason}` : `命令执行失败: ${command}`;
    return new ToolError(ToolErrorCode.COMMAND_ERROR, message, true);
  }

  static gitError(reason?: string): ToolError {
    const message = reason ? `Git 操作失败: ${reason}` : 'Git 操作失败';
    return new ToolError(ToolErrorCode.GIT_ERROR, message, true);
  }

  static unknownError(reason?: string): ToolError {
    const message = reason ? `未知错误: ${reason}` : '未知错误';
    return new ToolError(ToolErrorCode.UNKNOWN_ERROR, message, true);
  }

  toToolResult(toolCallId: string = ''): { tool_call_id: string; output: string; error: string } {
    return {
      tool_call_id: toolCallId,
      output: '',
      error: `${this.message}\n建议: ${this.suggestion}`,
    };
  }
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

export function handleToolError(
  error: unknown,
  toolCallId: string = ''
): { tool_call_id: string; output: string; error: string } {
  if (isToolError(error)) {
    return error.toToolResult(toolCallId);
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    tool_call_id: toolCallId,
    output: '',
    error: `执行失败: ${message}`,
  };
}
