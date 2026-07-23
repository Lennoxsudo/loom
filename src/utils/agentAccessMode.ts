import type { AgentAccessMode } from '../types/settings';
import { CREATE_DELETE_TOOLS, EXECUTE_TOOLS, WRITE_TOOLS } from './agentTools';

export const READ_ONLY_TOOL_NAMES = new Set([
  'read',
  'search',
  'finfo',
  'sym',
  'fetch',
  'web_search',
  'read_file',
  'search_content',
  'search_files',
  'get_file_tree',
  'get_file_info',
  'get_symbol_definition',
  'fetch_web_content',
  'load_skill',
  'list_directory',
]);

const COMMAND_TOOL_NAMES = new Set([...EXECUTE_TOOLS]);

const WRITE_OR_MUTATE_TOOL_NAMES = new Set([
  ...WRITE_TOOLS,
  ...CREATE_DELETE_TOOLS,
  'generate_image',
]);

function normalizeToolNameForAccess(toolName: string): string {
  if (!toolName.startsWith('mcp_')) {
    return toolName;
  }
  const separatorIndex = toolName.indexOf('__');
  if (separatorIndex < 0) {
    return toolName;
  }
  return toolName.slice(separatorIndex + 2);
}

export function isReadOnlyTool(toolName: string): boolean {
  const normalized = normalizeToolNameForAccess(toolName);
  return READ_ONLY_TOOL_NAMES.has(normalized);
}

export function isCommandTool(toolName: string): boolean {
  const normalized = normalizeToolNameForAccess(toolName);
  return COMMAND_TOOL_NAMES.has(normalized);
}

export function isWriteOrMutateTool(toolName: string): boolean {
  const normalized = normalizeToolNameForAccess(toolName);

  // MCP 工具：先归一化，再对照已知分类，避免把所有 MCP 工具一棍子打死
  if (toolName.startsWith('mcp_')) {
    // 匹配到已知的只读工具 → 不是写操作
    if (READ_ONLY_TOOL_NAMES.has(normalized)) {
      return false;
    }
    // 匹配到已知的写/变更工具 → 是写操作
    if (WRITE_OR_MUTATE_TOOL_NAMES.has(normalized) || COMMAND_TOOL_NAMES.has(normalized)) {
      return true;
    }
    // 未知 MCP 工具：保守处理，视为潜在危险
    return true;
  }

  return WRITE_OR_MUTATE_TOOL_NAMES.has(normalized);
}

export function shouldBlockTool(accessMode: AgentAccessMode, toolName: string): boolean {
  if (accessMode !== 'read_only') {
    return false;
  }
  return !isReadOnlyTool(toolName);
}

export function shouldRequestApproval(accessMode: AgentAccessMode, toolName: string): boolean {
  if (accessMode !== 'auto') {
    return false;
  }
  // auto 模式：仅删除文件需要审批。
  // 普通命令执行、文件写入/编辑由 requiresConfirmation 按危险模式判断。
  const normalized = normalizeToolNameForAccess(toolName);
  return normalized === 'delete_file';
}

export function isToolFilteredInReadOnlyProviderList(toolName: string): boolean {
  return isCommandTool(toolName) || isWriteOrMutateTool(toolName);
}
