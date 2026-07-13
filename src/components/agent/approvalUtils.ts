import {
  CREATE_DELETE_TOOLS,
  EXECUTE_TOOLS,
  GIT_TOOLS,
  WRITE_TOOLS,
} from '../../utils/agentTools';
import type { AgentAccessMode } from '../../types/settings';
import { requiresConfirmation } from '../../utils/toolGuard';
import type { ToolCall } from '../../features/agent-engine';
import type { ChatApprovalActionType, ChatApprovalSummary } from '../chat/types';

export interface ApprovalSummaryLabels {
  commandType: string;
  fileType: string;
  createFileType?: string;
  createFolderType?: string;
  deleteFileType?: string;
  deleteFolderType?: string;
  moveFileType?: string;
  gitType: string;
  mcpType: string;
}

function getStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function stripMcpPrefix(toolName: string): string {
  return toolName.replace(/^mcp_[^_]+__/, '');
}

export function getApprovalType(
  toolName: string,
  underlyingToolName: string,
  args: Record<string, unknown> = {}
): ChatApprovalActionType | null {
  if (toolName.startsWith('mcp_')) {
    return 'mcp';
  }
  if (EXECUTE_TOOLS.has(toolName) || EXECUTE_TOOLS.has(underlyingToolName)) {
    return 'command';
  }
  const graphAction =
    typeof args.action === 'string' ? args.action.toLowerCase() : '';
  if (
    (toolName === 'graph_index' || underlyingToolName === 'graph_index') &&
    (graphAction === 'index' || graphAction === '')
  ) {
    return 'command';
  }
  if (
    WRITE_TOOLS.has(toolName) ||
    WRITE_TOOLS.has(underlyingToolName) ||
    CREATE_DELETE_TOOLS.has(toolName) ||
    CREATE_DELETE_TOOLS.has(underlyingToolName)
  ) {
    return 'file';
  }
  if (GIT_TOOLS.has(toolName) || GIT_TOOLS.has(underlyingToolName)) {
    return 'git';
  }
  return null;
}

export function buildApprovalSummary(
  toolCall: ToolCall,
  normalizedArgs: Record<string, unknown>,
  underlyingToolName: string,
  targetIsDirectory: boolean | undefined,
  existedBefore: boolean | undefined,
  labels: ApprovalSummaryLabels
): ChatApprovalSummary | null {
  const type = getApprovalType(toolCall.function.name, underlyingToolName, normalizedArgs);
  if (!type) return null;

  const normalizedAction =
    typeof normalizedArgs.action === 'string' ? normalizedArgs.action.toLowerCase() : '';

  const detail =
    type === 'command'
      ? underlyingToolName === 'graph_index'
        ? getStringArg(normalizedArgs, ['action', 'repo_path']) ?? 'index'
        : getStringArg(normalizedArgs, ['command'])
      : type === 'file'
        ? getStringArg(normalizedArgs, [
            'path',
            'file_path',
            'file',
            'source',
            'destination',
            'folder_path',
          ])
        : type === 'git'
          ? getStringArg(normalizedArgs, ['action', 'repo_path', 'file_path'])
          : stripMcpPrefix(toolCall.function.name);

  const deleteLooksLikeFolder =
    normalizedAction === 'delete' &&
    (targetIsDirectory === true ||
      typeof normalizedArgs.folder_path === 'string' ||
      (typeof detail === 'string' && /[\\/]$/.test(detail)));

  const label =
    type === 'command'
      ? labels.commandType
      : type === 'file'
        ? underlyingToolName === 'delete_file' || normalizedAction === 'delete'
          ? deleteLooksLikeFolder
            ? (labels.deleteFolderType ?? 'Delete folder')
            : (labels.deleteFileType ?? 'Delete file')
          : underlyingToolName === 'move_file' || normalizedAction === 'move'
            ? (labels.moveFileType ?? 'Move file')
            : underlyingToolName === 'create_folder' ||
                normalizedAction === 'create_folder' ||
                normalizedAction === 'mkdir'
              ? (labels.createFolderType ?? 'Create folder')
              : (underlyingToolName === 'write_file' ||
                    underlyingToolName === 'write' ||
                    normalizedAction === 'create') &&
                  existedBefore !== true
                ? (labels.createFileType ?? 'Create file')
                : labels.fileType
        : type === 'git'
          ? labels.gitType
          : labels.mcpType;

  return {
    type,
    toolName: toolCall.function.name,
    label,
    detail: detail || underlyingToolName,
  };
}

export function needsAgentApproval(
  accessMode: AgentAccessMode,
  toolCall: ToolCall,
  parsedArgs: Record<string, unknown>,
  summary: ChatApprovalSummary | null
): boolean {
  if (!summary) {
    return false;
  }
  if (accessMode === 'read_only') {
    return true;
  }
  if (accessMode === 'auto') {
    // auto 模式：仅删除文件、危险命令模式、显式标记需审批的工具才弹卡片
    // 普通写入/编辑、普通命令执行、Git 操作、MCP 工具直接放行
    if (summary.type === 'command') {
      // 命令类：只有匹配危险模式（rm -rf, sudo, git push 等）才需审批
      return requiresConfirmation(toolCall.function.name, parsedArgs, accessMode);
    }
    if (summary.type === 'file') {
      // 文件类：只有删除操作才需审批
      const action = typeof parsedArgs.action === 'string' ? parsedArgs.action.toLowerCase() : '';
      const toolName = toolCall.function.name.toLowerCase();
      return toolName.includes('delete') || action === 'delete';
    }
    // git / mcp 直接放行
    return false;
  }
  return requiresConfirmation(toolCall.function.name, parsedArgs, accessMode);
}

export interface ToolApprovalRejectionLabels {
  rejectedToolResult: string;
  rejectedToolResultWithTarget: string;
}

export function buildToolApprovalRejectionText(
  toolName: string,
  parsedArgs: Record<string, unknown>,
  labels: ToolApprovalRejectionLabels
): string {
  const cleanName = stripMcpPrefix(toolName);
  const target = getStringArg(parsedArgs, [
    'path',
    'file_path',
    'file',
    'command',
    'script',
    'source',
    'destination',
    'target',
  ]);
  if (target) {
    return labels.rejectedToolResultWithTarget
      .replaceAll('{toolName}', cleanName)
      .replaceAll('{target}', target);
  }
  return labels.rejectedToolResult.replaceAll('{toolName}', cleanName);
}

export interface AgentPendingApproval {
  summary: ChatApprovalSummary;
  resolve: (approved: boolean) => void;
}
