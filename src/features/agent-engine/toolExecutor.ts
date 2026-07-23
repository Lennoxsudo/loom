import type { ToolCall, ToolResult } from '../../types/ai';
import type { ToolContext } from './types';
import type { ToolName } from './toolArgs';
import { getToolHandler } from './registry';
import { parseToolArguments } from './argsParser';
import { normalizeToolArgs } from './paramNormalizer';
import { isMergedToolName, executeMergedToolCall } from './toolRouter';
import { toolCache, executeWithCache } from './toolCache';
import { validateToolParameters } from './schema';
import { mcpClient } from '../../utils/mcpClient';
import { resolvePathWithBaseDir } from './argsParser';
import { normalizePathForCompare } from '../../shared/lib/pathUtils';
import { agentEngineEvents } from './events';

function emitToolStart(toolName: string, toolCallId: string, context?: ToolContext): void {
  agentEngineEvents.emit('toolCallStart', { toolName, toolCallId });
  context?.onToolCall?.({ toolName, toolCallId });
}

function emitToolEnd(
  toolName: string,
  toolCallId: string,
  success: boolean,
  context?: ToolContext,
  error?: string
): void {
  agentEngineEvents.emit('toolCallEnd', { toolName, toolCallId, success, error });
  context?.onToolCallEnd?.({ toolName, toolCallId, success, error });
}

export async function executeToolCall(
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolResult> {
  const { id, function: func } = toolCall;
  const { name, arguments: argsStr } = func;

  emitToolStart(name, id, context);

  try {
    const rawArgsStr = typeof argsStr === 'string' ? argsStr : JSON.stringify(argsStr ?? {});

    if (isMergedToolName(name)) {
      const merged = await executeMergedToolCall(toolCall, context);
      emitToolEnd(name, id, !merged.error, context, merged.error);
      return merged;
    }

    // MCP 工具路由：mcp_<serverId>__<toolName> 格式
    if (name.startsWith('mcp_')) {
      const mcpResult = await executeMcpToolCall(toolCall);
      emitToolEnd(name, id, !mcpResult.error, context, mcpResult.error);
      return mcpResult;
    }

    let args: Record<string, unknown>;
    try {
      args = parseToolArguments(rawArgsStr) as Record<string, unknown>;
    } catch (parseError) {
      const err = `参数解析失败: ${parseError}`;
      emitToolEnd(name, id, false, context, err);
      return {
        tool_call_id: id,
        output: '',
        error: err,
      };
    }

    args = normalizeToolArgs(args, name);

    // Validate parameters with Zod schema
    const validationResult = validateToolParameters(name, args);
    if (!validationResult.success) {
      const err = `参数验证失败: ${validationResult.error}`;
      emitToolEnd(name, id, false, context, err);
      return {
        tool_call_id: id,
        output: '',
        error: err,
      };
    }
    args = validationResult.data;

    if (isKnownTool(name)) {
      const handler = getToolHandler(name);
      if (handler) {
        // 使用缓存执行工具
        const result = await executeWithCache(
          name,
          args,
          async () => {
            const toolResult = await handler.execute(args as never, {
              ...context,
              toolCallId: id,
            });

            // 如果是写操作，清理相关缓存
            if (toolResult.files_changed && toolResult.files_changed.length > 0) {
              clearCacheForChangedFiles(name, args, toolResult.files_changed, context);
            }

            return toolResult;
          },
          getCacheTTLForTool(name)
        );

        result.tool_call_id = id;
        emitToolEnd(name, id, !result.error, context, result.error);
        return result;
      }
    }

    const unknownErr = `未知的工具: ${name}。可用工具: ${getAvailableToolNames().join(', ')}`;
    emitToolEnd(name, id, false, context, unknownErr);
    return {
      tool_call_id: id,
      output: '',
      error: unknownErr,
    };
  } catch (error) {
    const err = `工具执行失败: ${error}`;
    emitToolEnd(name, id, false, context, err);
    return {
      tool_call_id: id,
      output: '',
      error: err,
    };
  }
}

/**
 * 所有已注册的内置工具名（含新短名 + legacy 别名 + handler 名）。
 * 不含 MCP 工具（mcp_* 前缀）和合并工具的子 action。
 */
const KNOWN_TOOL_NAMES: readonly string[] = [
  // New short names
  'read',
  'write',
  'edit',
  'term',
  'finfo',
  'search',
  'git',
  'sym',
  'browser',
  'fetch',
  'web_search',
  'todo',
  'update_plan',
  'exit_plan_mode',
  'ask',
  'skill',
  'generate_image',
  'run_subagent',
  'run_subagents',
  'Agent',
  'Task',
  'graph_index',
  'graph_query',
  'graph_trace',
  // Legacy names (for backward compatibility)
  'read_file',
  'write_file',
  'edit_file',
  'terminal',
  'file_info',
  'get_symbol_definition',
  'control_browser',
  'fetch_web_content',
  'TodoWrite',
  'ask_user_question',
  'load_skill',
  // Individual handler names
  'search_files',
  'search_content',
  'search_both',
  'list_directory',
  'create_folder',
  'get_file_tree',
  'get_file_info',
  'move_file',
  'delete_file',
  'run_command',
  'read_terminal_output',
  'list_bg_tasks',
  'kill_bg_task',
  'get_git_diff',
  'undo_changes',
];

const KNOWN_TOOL_SET: ReadonlySet<string> = new Set(KNOWN_TOOL_NAMES);

function isKnownTool(name: string): name is ToolName {
  return KNOWN_TOOL_SET.has(name);
}

/**
 * 判断工具名是否可被执行器识别。
 * 涵盖：合并工具（term/finfo/search/git 等）、MCP 工具（mcp_* 前缀）、内置工具。
 */
export function isKnownToolName(name: string): boolean {
  if (isMergedToolName(name)) return true;
  if (name.startsWith('mcp_')) return true;
  return isKnownTool(name);
}

/**
 * 返回所有可用内置工具名列表，用于未知工具错误提示。
 */
export function getAvailableToolNames(): string[] {
  return [...KNOWN_TOOL_NAMES];
}

/**
 * 根据工具类型获取缓存TTL（单位：毫秒）
 */
function getCacheTTLForTool(toolName: string): number {
  const toolTTL: Record<string, number> = {
    // 文件读取类：5分钟
    read: 5 * 60 * 1000,
    read_file: 5 * 60 * 1000,
    get_file_info: 5 * 60 * 1000,
    get_file_tree: 5 * 60 * 1000,

    // 搜索类：2分钟
    search_files: 2 * 60 * 1000,
    search_content: 2 * 60 * 1000,
    search_both: 2 * 60 * 1000,

    // 目录列表：5分钟
    list_directory: 5 * 60 * 1000,

    // Git相关：1分钟
    get_git_diff: 1 * 60 * 1000,

    // 符号定义：10分钟
    sym: 10 * 60 * 1000,
    get_symbol_definition: 10 * 60 * 1000,

    // 网络内容：15分钟
    fetch: 15 * 60 * 1000,
    fetch_web_content: 15 * 60 * 1000,
    // Web 搜索：5分钟（SERP 变化较快）
    web_search: 5 * 60 * 1000,

    // 合并工具
    finfo: 5 * 60 * 1000,
    file_info: 5 * 60 * 1000,
    search: 2 * 60 * 1000,
    graph_index: 10 * 60 * 1000,
    graph_query: 2 * 60 * 1000,
    graph_trace: 2 * 60 * 1000,
  };

  return toolTTL[toolName] || 5 * 60 * 1000; // 默认5分钟
}

/**
 * 文件变更时清理相关缓存
 */
function normalizeComparablePath(path: string): string {
  return normalizePathForCompare(path).toLowerCase();
}

function resolveComparablePath(path: string, baseDir?: string): string {
  try {
    return normalizeComparablePath(resolvePathWithBaseDir(path, baseDir));
  } catch {
    return normalizeComparablePath(path);
  }
}

function matchesChangedFilePath(
  candidatePath: unknown,
  changedFiles: string[],
  baseDir?: string
): boolean {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return false;
  }

  const normalizedCandidate = resolveComparablePath(candidatePath, baseDir);
  return changedFiles.some((file) => normalizedCandidate === resolveComparablePath(file, baseDir));
}

function isPathInsideChangedDirectories(
  candidatePath: unknown,
  changedFiles: string[],
  baseDir?: string
): boolean {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return false;
  }

  const normalizedCandidate = resolveComparablePath(candidatePath, baseDir).replace(/\/+$/, '');
  return changedFiles.some((file) => {
    const normalizedChanged = resolveComparablePath(file, baseDir);
    return (
      normalizedChanged.startsWith(`${normalizedCandidate}/`) ||
      normalizedChanged === normalizedCandidate
    );
  });
}

function clearCacheForChangedFiles(
  toolName: string,
  _args: Record<string, unknown>,
  changedFiles: string[],
  context?: ToolContext
): void {
  // 对于文件写操作，清理相关目录的缓存
  const writeTools = new Set([
    'write',
    'edit',
    'write_file',
    'edit_file',
    'create_folder',
    'move_file',
    'delete_file',
  ]);
  if (!writeTools.has(toolName)) return;

  // 清理所有相关的文件读取和搜索缓存
  const patternsToClear: Array<{ tool: string; paramMatcher: (params: any) => boolean }> = [
    // 清理相同文件的读取缓存
    {
      tool: 'read',
      paramMatcher: (params) =>
        matchesChangedFilePath(params.path ?? params.filePath, changedFiles, context?.baseDir),
    },
    {
      tool: 'read_file',
      paramMatcher: (params) =>
        matchesChangedFilePath(params.path ?? params.filePath, changedFiles, context?.baseDir),
    },
    {
      tool: 'finfo',
      paramMatcher: (params) =>
        matchesChangedFilePath(params.path ?? params.filePath, changedFiles, context?.baseDir),
    },
    {
      tool: 'get_file_info',
      paramMatcher: (params) =>
        matchesChangedFilePath(params.path ?? params.filePath, changedFiles, context?.baseDir),
    },
    // 清理包含该文件的目录列表缓存
    {
      tool: 'list_directory',
      paramMatcher: (params) =>
        isPathInsideChangedDirectories(params.path, changedFiles, context?.baseDir),
    },
    // 清理文件树缓存
    {
      tool: 'get_file_tree',
      paramMatcher: () => true, // 文件树总是需要刷新
    },
    // 清理搜索缓存（如果搜索路径包含变更文件）
    {
      tool: 'search',
      paramMatcher: (params) =>
        isPathInsideChangedDirectories(params.path, changedFiles, context?.baseDir),
    },
    {
      tool: 'search_files',
      paramMatcher: (params) => {
        return isPathInsideChangedDirectories(params.path, changedFiles, context?.baseDir);
      },
    },
    {
      tool: 'search_content',
      paramMatcher: (params) => {
        return isPathInsideChangedDirectories(params.path, changedFiles, context?.baseDir);
      },
    },
  ];

  // 清理缓存
  const cacheEntries = toolCache.getEntries();
  for (const entry of cacheEntries) {
    // 尝试解析参数
    try {
      const cacheKeyParts = entry.key.split(':');
      if (cacheKeyParts.length < 2) continue;

      const cacheToolName = cacheKeyParts[0];
      const cacheParamsStr = cacheKeyParts.slice(1).join(':');
      const cacheParams = JSON.parse(cacheParamsStr);

      // 检查是否需要清理此缓存条目
      const shouldClear = patternsToClear.some(
        (pattern) => pattern.tool === cacheToolName && pattern.paramMatcher(cacheParams)
      );

      if (shouldClear) {
        toolCache.delete(cacheToolName, cacheParams);
      }
    } catch {
      // 忽略解析错误的缓存条目
    }
  }
}

// ============================================================================
// MCP 工具执行
// ============================================================================

/**
 * 从 MCP 工具名中解析 serverId 和实际 toolName
 *
 * 格式: mcp_<serverId>__<toolName>
 */
function parseMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
  if (!fullName.startsWith('mcp_')) return null;

  const withoutPrefix = fullName.slice(4); // 去掉 "mcp_"
  const separatorIdx = withoutPrefix.indexOf('__');

  if (separatorIdx === -1) {
    return null;
  }

  return {
    serverId: withoutPrefix.slice(0, separatorIdx),
    toolName: withoutPrefix.slice(separatorIdx + 2),
  };
}

/**
 * 从 MCP 工具结果中提取文本内容
 */
function extractMcpTextContent(result: {
  success: boolean;
  content: unknown;
  content_items?: Array<{ type: string; text?: string }> | null;
  is_error?: boolean;
  error: string | null;
}): string {
  // 优先使用 content_items 中的文本
  if (result.content_items && result.content_items.length > 0) {
    const textParts: string[] = [];
    for (const item of result.content_items) {
      if (item.type === 'text' && item.text) {
        textParts.push(item.text);
      }
    }
    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  // Fallback: 从 content 字段提取
  if (result.content) {
    if (typeof result.content === 'string') {
      return result.content;
    }
    if (typeof result.content === 'object') {
      const content = result.content as { content?: Array<{ type?: string; text?: string }> };
      if (Array.isArray(content.content)) {
        const textParts: string[] = [];
        for (const item of content.content) {
          if (item.type === 'text' && item.text) {
            textParts.push(item.text);
          }
        }
        if (textParts.length > 0) return textParts.join('\n');
      }
      try {
        return JSON.stringify(result.content, null, 2);
      } catch {
        return String(result.content);
      }
    }
  }

  return '';
}

/**
 * 执行 MCP 工具调用
 *
 * 解析 mcp_<serverId>__<toolName> 格式，调用 MCP 服务器并返回文本结果。
 */
async function executeMcpToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const { id, function: func } = toolCall;
  const { name, arguments: argsStr } = func;

  try {
    const parsed = parseMcpToolName(name);
    if (!parsed) {
      return {
        tool_call_id: id,
        output: '',
        error: `无效的 MCP 工具名格式: ${name}。期望格式: mcp_<serverId>__<toolName>`,
      };
    }

    const { serverId, toolName } = parsed;

    // 解析调用参数
    let callArgs: Record<string, unknown> = {};
    try {
      const rawArgsStr = typeof argsStr === 'string' ? argsStr : JSON.stringify(argsStr ?? {});
      callArgs = JSON.parse(rawArgsStr) as Record<string, unknown>;
    } catch {
      // 解析失败则使用空参数
    }

    // 调用 MCP 服务器
    const result = await mcpClient.callTool(serverId, toolName, callArgs);

    // 处理错误
    if (!result.success && result.error) {
      return {
        tool_call_id: id,
        output: result.error,
        error: result.error,
      };
    }

    if (result.is_error) {
      const errorText = extractMcpTextContent(result) || result.error || 'MCP 工具执行失败';
      return {
        tool_call_id: id,
        output: errorText,
        error: errorText,
      };
    }

    // 提取文本输出
    const output = extractMcpTextContent(result);

    if (!output) {
      return {
        tool_call_id: id,
        output: result.error || 'MCP 工具未返回内容',
      };
    }

    return {
      tool_call_id: id,
      output,
    };
  } catch (error) {
    return {
      tool_call_id: id,
      output: '',
      error: `MCP 工具执行失败: ${error}`,
    };
  }
}
