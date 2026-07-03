/**
 * Agent 工具过滤与权限模块
 *
 * @module agentTools
 */

import type { AgentCapabilities } from './agentPersistence';

const MCP_TOOL_NAME_SEPARATOR = '__';

type CapabilityBlockType = 'execute' | 'browser' | 'git' | 'mcp' | 'createDelete';

export const EXECUTE_TOOLS = new Set([
  'create_terminal',
  'close_terminal',
  'run_command',
  'terminal',
  'term',
]);

export const BROWSER_TOOLS = new Set(['control_browser', 'fetch_web_content', 'browser', 'fetch']);

export const GIT_TOOLS = new Set(['get_git_diff', 'undo_changes', 'git']);

export const CREATE_DELETE_TOOLS = new Set([
  'create_folder',
  'move_file',
  'delete_file',
]);

export const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'write',
  'edit',
  'generate_image',
]);

const PLAN_MODE_BLOCKED_TOOLS = new Set([
  'write_file',
  'edit_file',
  'create_terminal',
  'close_terminal',
  'run_command',
  'terminal',
  'create_folder',
  'move_file',
  'delete_file',
  // New short names
  'write',
  'edit',
  'generate_image',
  'term',
]);

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  canExecuteCommands: true,
  canAccessBrowser: true,
  canUseGit: true,
  canUseMcp: true,
};

function normalizeToolName(toolName: string): string {
  if (!toolName.startsWith('mcp_')) {
    return toolName;
  }

  const separatorIndex = toolName.indexOf(MCP_TOOL_NAME_SEPARATOR);
  if (separatorIndex < 0) {
    return toolName;
  }

  return toolName.slice(separatorIndex + MCP_TOOL_NAME_SEPARATOR.length);
}

export function normalizeCapabilities(
  capabilities?: Partial<AgentCapabilities> | null
): AgentCapabilities {
  return {
    canExecuteCommands:
      capabilities?.canExecuteCommands ?? DEFAULT_AGENT_CAPABILITIES.canExecuteCommands,
    canAccessBrowser:
      capabilities?.canAccessBrowser ?? DEFAULT_AGENT_CAPABILITIES.canAccessBrowser,
    canUseGit: capabilities?.canUseGit ?? DEFAULT_AGENT_CAPABILITIES.canUseGit,
    canUseMcp: capabilities?.canUseMcp ?? DEFAULT_AGENT_CAPABILITIES.canUseMcp,
  };
}

export function getToolBlockedByCapability(
  toolName: string,
  capabilities?: Partial<AgentCapabilities> | null
): CapabilityBlockType | null {
  const normalizedToolName = normalizeToolName(toolName);
  const caps = normalizeCapabilities(capabilities);

  if (!caps.canExecuteCommands && EXECUTE_TOOLS.has(normalizedToolName)) {
    return 'execute';
  }

  if (!caps.canAccessBrowser && BROWSER_TOOLS.has(normalizedToolName)) {
    return 'browser';
  }

  if (!caps.canUseGit && GIT_TOOLS.has(normalizedToolName)) {
    return 'git';
  }

  // MCP check uses the original toolName (before normalization) since MCP tools have the mcp_ prefix
  if (!caps.canUseMcp && toolName.startsWith('mcp_')) {
    return 'mcp';
  }

  return null;
}

function isToolAllowedForAgent(
  toolName: string,
  capabilities?: Partial<AgentCapabilities> | null
): boolean {
  return getToolBlockedByCapability(toolName, capabilities) === null;
}

/**
 * 检查工具是否在计划模式下被禁止
 * @param toolName - 工具名称
 * @returns 是否被禁止
 */
export function isToolBlockedInPlanMode(toolName: string): boolean {
  // MCP 工具在计划模式下也禁止执行写入类操作
  if (toolName.startsWith('mcp_')) {
    const normalizedToolName = normalizeToolName(toolName);
    // 常见的 MCP 写入工具名称模式
    const mcpWritePatterns = ['write', 'edit', 'create', 'delete', 'update', 'save', 'execute', 'run'];
    const toolLower = normalizedToolName.toLowerCase();
    if (mcpWritePatterns.some(pattern => toolLower.includes(pattern))) {
      return true;
    }
  }
  return PLAN_MODE_BLOCKED_TOOLS.has(toolName);
}

export function filterToolsByCapabilities<T extends { name: string }>(
  tools: T[],
  capabilities?: Partial<AgentCapabilities> | null,
  isPlanMode?: boolean
): T[] {
  return tools.filter((tool) => {
    // 计划模式检查
    if (isPlanMode && isToolBlockedInPlanMode(tool.name)) {
      return false;
    }
    // 能力检查
    return isToolAllowedForAgent(tool.name, capabilities);
  });
}
