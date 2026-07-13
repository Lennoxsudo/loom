import { memo, useState, cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { GenerateImageToolCard } from './GenerateImageToolCard';
import { parseGenerateImageAbsolutePaths } from '../../utils/imageGenConfig';
import McpToolResultCard from './McpToolResultCard';
import BrowserToolResultCard from './BrowserToolResultCard';
import WebSearchToolResultCard from './WebSearchToolResultCard';
import SubagentCard from './SubagentCard';
import SubagentGroupCard from './SubagentGroupCard';
import ExecCommandCard from './ExecCommandCard';
import AskToolResultCard from './AskToolResultCard';
import GraphToolResultCard from './GraphToolResultCard';
import ToolApprovalBar, { ToolApprovalOutcomeLabel } from './ToolApprovalBar';
import { useEnableSubagents } from '../../stores';
import { isRunCommandToolName, parseCommandExecOutput } from '../../utils/parseCommandExecOutput';
import { useTranslation } from '../../i18n';
import type { ChatMessage } from '../../types/chat';
import {
  shortenId,
  summarizeKillBgTask,
  summarizeListBgTasks,
  summarizeSearchBoth,
} from './toolResultSummaries';
import { toolCardShell, toolCompactShell, TOOL_RESULT_WIDTH, formatToolDisplayName } from './toolResultLayout';
import { TodoInProgressIndicator } from './TodoInProgressIndicator';

interface ToolResultMessageProps {
  message: ChatMessage;
  dense?: boolean;
  onApproveTool?: (messageId: string) => void;
  onRejectTool?: (messageId: string) => void;
}

const TOOL_SURFACE = 'var(--bg-sidebar)';
const TOOL_SURFACE_SOFT = 'var(--surface-overlay-soft)';
const TOOL_BORDER_SOFT = 'var(--surface-overlay-border)';
const TOOL_TEXT = 'var(--text-primary)';
const TOOL_TEXT_MUTED = 'var(--text-secondary)';
const TOOL_TEXT_SUBTLE = 'color-mix(in srgb, var(--text-secondary) 82%, var(--bg-app))';
const TOOL_SUCCESS = 'color-mix(in srgb, #2f9e44 82%, var(--text-primary))';
const TOOL_SUCCESS_BG = 'color-mix(in srgb, #2f9e44 12%, var(--bg-sidebar))';
const TOOL_WARNING = 'color-mix(in srgb, var(--text-warning) 88%, var(--text-primary))';
const TOOL_WARNING_BG = 'color-mix(in srgb, var(--text-warning) 14%, var(--bg-sidebar))';
const TOOL_ERROR = 'var(--text-error)';
const TOOL_ERROR_BG = 'color-mix(in srgb, var(--text-error) 10%, var(--bg-sidebar))';
const TOOL_HOVER = 'color-mix(in srgb, var(--surface-overlay-soft) 100%, var(--bg-sidebar))';

/** Strip fenced code blocks before error heuristics — tool output often embeds source containing "failed", "error:", etc. */
function stripCodeFencesForErrorHeuristics(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

function matchesToolErrorSummaryHeuristics(text: string): boolean {
  const summary = stripCodeFencesForErrorHeuristics(text);
  return summary.startsWith('❌')
    || summary.includes('错误:')
    || summary.includes('执行失败')
    || summary.includes('编辑失败')
    || summary.includes('无法写入')
    || summary.includes('无法编辑')
    || summary.includes('无法读取')
    || summary.includes('无法删除')
    || summary.includes('无法移动')
    || summary.includes('文件不存在')
    || summary.includes('缺少必需参数')
    || summary.includes('参数无效')
    || summary.includes('权限不足')
    || summary.includes('权限被拒绝')
    || summary.toLowerCase().includes('failed')
    || summary.toLowerCase().includes('error:');
}

const ToolResultMessage = memo(function ToolResultMessage({
  message,
  dense,
  onApproveTool,
  onRejectTool,
}: ToolResultMessageProps) {
  const t = useTranslation();
  const enableSubagents = useEnableSubagents();
  const [isExpanded, setIsExpanded] = useState(false);
  const compactMarginBottom = dense ? '6px' : '6px';
  const createCompactStyle = (marginBottom = compactMarginBottom): CSSProperties => ({
    ...toolCompactShell(marginBottom),
    color: TOOL_TEXT_MUTED,
  });
  const createToolCardStyle = (marginBottom = compactMarginBottom): CSSProperties =>
    toolCardShell(marginBottom);
  const fileReadTools = ['read', 'read_file', 'view_file', 'get_file_info', 'finfo'];
  const isFileReadTool = fileReadTools.includes(message.tool_name || '');
  const isWriteFileTool = message.tool_name === 'write' || message.tool_name === 'write_file';

  const isPendingApproval =
    message.approvalStatus === 'pending' && message.approvalSummary != null;
  const approvalOutcome =
    message.approvalStatus === 'approved'
      ? ('approved' as const)
      : message.approvalStatus === 'rejected'
        ? ('denied' as const)
        : null;

  const renderPendingActions = () => {
    if (!isPendingApproval || !onApproveTool || !onRejectTool) return null;
    return (
      <ToolApprovalBar
        status="pending"
        layout="header"
        onApprove={() => onApproveTool(message.id)}
        onReject={() => onRejectTool(message.id)}
      />
    );
  };

  const wrapCompactRow = (rowStyle: CSSProperties, content: ReactNode) => {
    if (isPendingApproval || approvalOutcome) {
      return (
        <div style={{ ...TOOL_RESULT_WIDTH, marginBottom: compactMarginBottom }}>
          <div
            style={{
              ...rowStyle,
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: 0,
                flex: 1,
              }}
            >
              {content}
            </div>
            {isPendingApproval ? (
              renderPendingActions()
            ) : approvalOutcome ? (
              <ToolApprovalOutcomeLabel status={approvalOutcome} />
            ) : null}
          </div>
        </div>
      );
    }

    return <div style={rowStyle}>{content}</div>;
  };

  const wrapCommandCardRow = (card: ReactNode) => {
    if (!isPendingApproval && !approvalOutcome) return card;

    // Build approval footer content to pass into ExecCommandCard
    let approvalFooter: ReactNode = undefined;
    let approvalStatus: 'pending' | 'approved' | 'denied' | undefined = undefined;

    if (isPendingApproval) {
      approvalStatus = 'pending';
      approvalFooter = (
        <ToolApprovalBar
          status="pending"
          layout="footer"
          onApprove={() => onApproveTool?.(message.id)}
          onReject={() => onRejectTool?.(message.id)}
        />
      );
    } else if (approvalOutcome) {
      approvalStatus = approvalOutcome;
      approvalFooter = (
        <ToolApprovalBar status={approvalOutcome} layout="footer" />
      );
    }

    // Clone the card element to inject footer + approvalStatus props
    if (isValidElement(card)) {
      return (
        <div style={{ ...TOOL_RESULT_WIDTH, marginBottom: compactMarginBottom }}>
          {cloneElement(card as React.ReactElement<{
            footer?: ReactNode;
            approvalStatus?: 'pending' | 'approved' | 'denied';
          }>, {
            footer: approvalFooter,
            approvalStatus,
          })}
        </div>
      );
    }

    return (
      <div style={{ ...TOOL_RESULT_WIDTH, marginBottom: compactMarginBottom }}>
        {card}
      </div>
    );
  };

  // 统一错误检测：优先使用结构化 isError 字段，兜底使用文本模式匹配（排除代码块内容）
  const isToolError =
    approvalOutcome === 'denied'
      ? false
      : message.isError === true
        || (message.isError !== false
          && !isPendingApproval
          && matchesToolErrorSummaryHeuristics(message.text));

  if (isPendingApproval) {
    const summary = message.approvalSummary;
    const cleanToolName = formatToolDisplayName(message.tool_name);

    if (
      isRunCommandToolName(message.tool_name, message.tool_args) ||
      message.tool_name === 'delete_file' ||
      message.tool_name === 'write' ||
      message.tool_name === 'write_file' ||
      message.tool_name === 'edit' ||
      message.tool_name === 'edit_file'
    ) {
      // Handled in dedicated tool branches below with the same compact row layout.
    } else {
      return (
        <>
          {wrapCompactRow(createCompactStyle('0'), (
            <>
              <span style={{ color: TOOL_TEXT_MUTED }}>{cleanToolName}</span>
              {summary?.label && (
                <span style={{ color: TOOL_TEXT_SUBTLE }}>{summary.label}</span>
              )}
            </>
          ))}
          {summary?.detail && (
            <div style={{ ...TOOL_RESULT_WIDTH, marginBottom: compactMarginBottom }}>
              <pre
                style={{
                  margin: '6px 0 0',
                  padding: '9px 11px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  lineHeight: 1.55,
                  color: TOOL_TEXT,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '180px',
                  overflowY: 'auto',
                  borderRadius: '7px',
                  border: `1px solid ${TOOL_BORDER_SOFT}`,
                  background: TOOL_SURFACE_SOFT,
                }}
              >
                {summary.detail}
              </pre>
            </div>
          )}
        </>
      );
    }
  }

  // run_subagent / Agent / Task: render SubagentCard
  if (
    enableSubagents &&
    (message.tool_name === 'run_subagent' ||
      message.tool_name === 'Agent' ||
      message.tool_name === 'Task')
  ) {
    const fallbackDescription =
      typeof message.tool_args?.prompt === 'string'
        ? message.tool_args.prompt
        : typeof message.tool_args?.task === 'string'
          ? message.tool_args.task
          : typeof message.tool_args?.description === 'string'
            ? message.tool_args.description
            : undefined;
    const fallbackSubagentType =
      typeof message.tool_args?.subagent_type === 'string'
        ? message.tool_args.subagent_type
        : typeof message.tool_args?.preset === 'string'
          ? message.tool_args.preset
          : undefined;

    const persistedRun = message.subagentRuns?.[0];

    return (
      <SubagentCard
        taskId={message.tool_call_id || ''}
        fallbackDescription={fallbackDescription}
        fallbackSubagentType={fallbackSubagentType}
        fallbackStatus={persistedRun?.status}
      />
    );
  }

  // run_subagents: render SubagentsGroupCard
  if (enableSubagents && message.tool_name === 'run_subagents') {
    return (
      <SubagentGroupCard
        toolCallId={message.tool_call_id || ''}
        persistedRuns={message.subagentRuns}
      />
    );
  }

  // generate_image: glass viewport pending + reveal result
  if (message.tool_name === 'generate_image') {
    const prompt =
      typeof message.tool_args?.prompt === 'string' ? message.tool_args.prompt : undefined;
    const size =
      typeof message.tool_args?.size === 'string' ? message.tool_args.size : undefined;
    const rawCount = message.tool_args?.n;
    const imageCount =
      typeof rawCount === 'number' && Number.isFinite(rawCount)
        ? Math.min(Math.max(Math.trunc(rawCount), 1), 4)
        : 1;
    const imagePaths = message.text ? parseGenerateImageAbsolutePaths(message.text) : [];
    const isPending = message.isStreaming === true && !message.text;

    return (
      <GenerateImageToolCard
        dense={dense}
        prompt={prompt}
        size={size}
        imagePaths={imagePaths}
        imageCount={imageCount}
        isPending={isPending}
        isError={isToolError}
        errorText={isToolError ? message.text : undefined}
      />
    );
  }

  if (isRunCommandToolName(message.tool_name, message.tool_args)) {
    const isRunning =
      message.isStreaming === true && !/<exit-code>/.test(message.text);
    const parsed = parseCommandExecOutput(message.text, message.tool_args, { isRunning });
    return wrapCommandCardRow(
      <ExecCommandCard
        dense={dense}
        parsed={parsed}
        isRunning={isRunning}
        isError={isToolError}
      />
    );
  }

  // Streaming tool call: show a pending card while waiting for result
  const isStreamingTool = message.isStreaming === true && !message.text;
  if (isStreamingTool) {
    const pendingToolName = formatToolDisplayName(message.tool_name);
    const pendingAccent = TOOL_WARNING;
    const pendingBadgeBg = TOOL_WARNING_BG;
    const pendingBadgeColor = TOOL_WARNING;
    const pendingContainerStyle: CSSProperties = {
      ...TOOL_RESULT_WIDTH,
      marginBottom: compactMarginBottom,
    };
    const pendingCardStyle: CSSProperties = {
      borderRadius: '8px',
      overflow: 'hidden',
      background: TOOL_SURFACE,
      border: `1px solid ${TOOL_BORDER_SOFT}`,
      borderLeft: `3px solid ${pendingAccent}`,
    };
    const pendingHeaderStyle: CSSProperties = {
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      userSelect: 'none',
    };
    return (
      <div style={pendingContainerStyle}>
        <div style={pendingCardStyle}>
          <div style={pendingHeaderStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 500,
                color: TOOL_TEXT_MUTED,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {pendingToolName}
              </span>
              <span style={{
                fontSize: '10px',
                fontWeight: 500,
                color: pendingBadgeColor,
                background: pendingBadgeBg,
                padding: '1px 8px',
                borderRadius: '10px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                ⏳ {t.agentInternal.callAgentRunning || 'running'}
              </span>
            </div>
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                border: `2px solid ${TOOL_WARNING_BG}`,
                borderTopColor: pendingAccent,
                animation: 'spin 1s linear infinite',
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (message.tool_name?.startsWith('mcp_')) {
    return (
      <McpToolResultCard
        message={message}
        statusLabel={t.common.completed}
        failedLabel={t.common.failed}
        summaryLabel="Summary"
        argumentsLabel={t.settingsMcp.servers.args}
        rawOutputLabel="Raw Output"
      />
    );
  }

  let displayName = formatToolDisplayName(message.tool_name, t.agentInternal.toolResult);
  if (isFileReadTool) {
    const args = message.tool_args || {};
    const pathFromArgs = args.path as string | undefined;
    const startLine = args.start_line as number | undefined;
    const maxLines = args.max_lines as number | undefined;

    let fileName = 'file';
    if (pathFromArgs) {
      fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
    } else {
      const pathMatch = message.text.match(/(?:path|file)[:\s]+["']?([^"'\n\r]+)/i);
      const fileNameMatch = message.text.match(/([^/\\]+\.[a-zA-Z0-9]+)/);
      if (pathMatch) {
        fileName = pathMatch[1].split(/[/\\]/).pop() || pathMatch[1];
      } else if (fileNameMatch) {
        fileName = fileNameMatch[1];
      }
    }

    // 有 max_lines 时显示行号范围
    if (maxLines !== undefined) {
      const start = startLine ?? 1; // 默认从第1行开始
      const endLine = start + maxLines - 1;
      displayName = `Read ${fileName} ${start}-${endLine}`;
    } else if (startLine !== undefined) {
      displayName = `Read ${fileName} ${startLine}+`;
    } else {
      displayName = `Read ${fileName}`;
    }
  }

  // File read tools: keep compact one-line style
  if (isFileReadTool) {
    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>{displayName}</span>
      </div>
    );
  }

  // write_file: compact "write filename +xx" style
  if (isWriteFileTool) {
    const args = message.tool_args || {};
    const pathFromArgs = args.path as string | undefined;
    const contentFromArgs = args.content as string | undefined;
    const isError = isToolError;

    let fileName = 'file';
    if (pathFromArgs) {
      fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
    } else {
      // Fallback: extract from result text "成功写入文件: path"
      const pathMatch = message.text.match(/成功写入文件:\s*(.+?)(?:\n|$)/);
      if (pathMatch) {
        fileName = pathMatch[1].trim().split(/[/\\]/).pop() || pathMatch[1].trim();
      }
    }

    // Count lines from content
    let addedLines = 0;
    if (contentFromArgs) {
      addedLines = contentFromArgs.split('\n').length;
    } else {
      // Fallback: estimate from character count in result text
      const charMatch = message.text.match(/写入了\s*(\d+)\s*个字符/);
      if (charMatch) {
        // Rough estimate: ~40 chars per line
        addedLines = Math.max(1, Math.round(parseInt(charMatch[1], 10) / 40));
      }
    }

    const compactStyle = createCompactStyle(dense ? '3px' : '10px');

    return wrapCompactRow(
      compactStyle,
      <span>
        {formatToolDisplayName('write')}{' '}
        <span style={{ color: TOOL_TEXT }}>{fileName}</span>
        {!isError && addedLines > 0 && (
          <span style={{ color: TOOL_SUCCESS, marginLeft: '6px' }}>+{addedLines}</span>
        )}
        {isError && (
          <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
        )}
      </span>
    );
  }

  // edit_file: compact "edit filename +xx -xx" style
  if (message.tool_name === 'edit' || message.tool_name === 'edit_file') {
    const args = message.tool_args || {};
    const pathFromArgs = args.path as string | undefined;
    const oldString = args.old_string as string | undefined;
    const newString = args.new_string as string | undefined;
    const isError = isToolError;

    let fileName = 'file';
    if (pathFromArgs) {
      fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
    } else {
      const pathMatch = message.text.match(/文件:\s*(.+?)(?:\n|$)/);
      if (pathMatch) {
        fileName = pathMatch[1].trim().split(/[/\\]/).pop() || pathMatch[1].trim();
      }
    }

    const removedLines = oldString ? oldString.split('\n').length : 0;
    const addedLines = newString ? newString.split('\n').length : 0;

    const compactStyle = createCompactStyle();

    return wrapCompactRow(
      compactStyle,
      <span>
        {formatToolDisplayName('edit')}{' '}
        <span style={{ color: TOOL_TEXT }}>{fileName}</span>
        {!isError && addedLines > 0 && (
          <span style={{ color: TOOL_SUCCESS, marginLeft: '6px' }}>+{addedLines}</span>
        )}
        {!isError && removedLines > 0 && (
          <span style={{ color: TOOL_ERROR, marginLeft: '4px' }}>-{removedLines}</span>
        )}
        {isError && (
          <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
        )}
      </span>
    );
  }

  // delete_file: compact "delete filename" style
  if (message.tool_name === 'delete_file') {
    const args = message.tool_args || {};
    const pathFromArgs = args.path as string | undefined;
    const isError = isToolError;

    let fileName = 'file';
    if (pathFromArgs) {
      fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
    } else {
      const pathMatch = message.text.match(/(?:已.*删除|已移入回收站)[^:]*:\s*(.+?)$/m);
      if (pathMatch) {
        fileName = pathMatch[1].trim().split(/[/\\]/).pop() || pathMatch[1].trim();
      }
    }

    const compactStyle: CSSProperties = {
      ...createCompactStyle(),
      gap: '8px',
    };

    return wrapCompactRow(
      compactStyle,
      <>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 6px',
          borderRadius: '999px',
          background: TOOL_ERROR_BG,
          color: TOOL_ERROR,
          fontSize: '10px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}>
          DEL
        </span>
        <span style={{
          color: TOOL_TEXT,
          background: TOOL_SURFACE_SOFT,
          padding: '2px 6px',
          borderRadius: '6px',
          textDecoration: approvalOutcome === 'denied' ? undefined : 'line-through',
          textDecorationThickness: '1px',
          textDecorationColor: 'color-mix(in srgb, var(--text-error) 60%, transparent)',
        }}>
          {fileName}
        </span>
        {isError && (
          <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
        )}
      </>
    );
  }

  // move_file: compact "Rename name -> newname" or "move ~folder/file -> ~folder/file" style
  if (message.tool_name === 'move_file') {
    const args = message.tool_args || {};
    const source = (args.source as string) || '';
    const destination = (args.destination as string) || '';
    const isError = isToolError;

    const parts = (p: string) => {
      const segs = p.replace(/\\/g, '/').split('/').filter(Boolean);
      return { dir: segs.slice(0, -1), name: segs[segs.length - 1] || p };
    };

    const src = parts(source);
    const dst = parts(destination);
    const isSameDir = src.dir.join('/') === dst.dir.join('/');

    const shortPath = (p: { dir: string[]; name: string }) => {
      if (p.dir.length === 0) return p.name;
      return `~${p.dir[p.dir.length - 1]}/${p.name}`;
    };

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          {isSameDir ? 'Rename' : formatToolDisplayName('move')}{' '}
          <span style={{ color: TOOL_TEXT }}>{isSameDir ? src.name : shortPath(src)}</span>
          <span style={{ color: TOOL_TEXT_SUBTLE, margin: '0 4px' }}>→</span>
          <span style={{ color: TOOL_TEXT }}>{isSameDir ? dst.name : shortPath(dst)}</span>
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
          )}
        </span>
      </div>
    );
  }

  // copy_file: compact "Copy src → dst" style
  if (message.tool_name === 'copy_file') {
    const args = message.tool_args || {};
    const source = (args.source as string) || '';
    const destination = (args.destination as string) || '';
    const isError = isToolError;

    const parts = (p: string) => {
      const segs = p.replace(/\\/g, '/').split('/').filter(Boolean);
      return { dir: segs.slice(0, -1), name: segs[segs.length - 1] || p };
    };

    const src = parts(source);
    const dst = parts(destination);
    const isSameDir = src.dir.join('/') === dst.dir.join('/');

    const shortPath = (p: { dir: string[]; name: string }) => {
      if (p.dir.length === 0) return p.name;
      return `~${p.dir[p.dir.length - 1]}/${p.name}`;
    };

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Copy{' '}
          <span style={{ color: TOOL_TEXT }}>{isSameDir ? src.name : shortPath(src)}</span>
          <span style={{ color: TOOL_TEXT_SUBTLE, margin: '0 4px' }}>→</span>
          <span style={{ color: TOOL_TEXT }}>{isSameDir ? dst.name : shortPath(dst)}</span>
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
          )}
        </span>
      </div>
    );
  }

  // search_files: custom "Searched [count] files" style
  if (message.tool_name === 'search_files') {
    const isError = isToolError;
    
    let fileCount = 0;
    const countMatch = message.text.match(/找到\s*(\d+)\s*个匹配文件/);
    if (countMatch) {
      fileCount = parseInt(countMatch[1], 10);
    } else if (!isError) {
      fileCount = (message.text.match(/^- /gm) || []).length;
    }

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Searched <span style={{ color: TOOL_TEXT }}>{fileCount}</span> files
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
          )}
        </span>
      </div>
    );
  }

  // search_content: custom "Searchcontent [count] Place" style
  if (message.tool_name === 'search_content') {
    const isError = isToolError;

    let matchCount = 0;
    const totalMatchItems = message.text.match(/(\d+)\s*个匹配项/g);
    if (totalMatchItems) {
      matchCount = totalMatchItems.reduce((sum, item) => {
        const num = parseInt(item.match(/\d+/)?.[0] || '0', 10);
        return sum + num;
      }, 0);
    }
    if (!matchCount) {
      const fileCountMatch = message.text.match(/找到\s*(\d+)\s*个文件包含/);
      if (fileCountMatch) {
        matchCount = parseInt(fileCountMatch[1], 10);
      }
    }
    if (!matchCount && !isError) {
      matchCount = (message.text.match(/^📄 /gm) || []).length;
    }

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Searchcontent <span style={{ color: TOOL_TEXT }}>{matchCount}</span> Place
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // search_both: combined filename + content search
  if (message.tool_name === 'search_both') {
    const isError = isToolError;
    const summary = summarizeSearchBoth(message.text, message.tool_args);
    const queryLabel = summary.query ? `"${summary.query}"` : '';
    const compactStyle = createCompactStyle();

    const summaryLine = (
      <span>
        Search both
        {queryLabel && <span style={{ color: TOOL_TEXT }}> · {queryLabel}</span>}
        {summary.noMatches ? (
          <span style={{ color: TOOL_TEXT_SUBTLE }}> · no matches</span>
        ) : (
          <>
            {summary.fileCount !== null && summary.fileCount > 0 && (
              <span style={{ color: TOOL_TEXT }}> · {summary.fileCount} files</span>
            )}
            {summary.placeCount !== null && summary.placeCount > 0 && (
              <span style={{ color: TOOL_TEXT }}> · {summary.placeCount} places</span>
            )}
          </>
        )}
        {isError && <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>}
      </span>
    );

    if (summary.expandable) {
      const headerStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: '12px',
        color: TOOL_TEXT_MUTED,
      };
      const contentStyle: CSSProperties = {
        marginTop: '6px',
        paddingLeft: '2px',
        fontSize: '12px',
        lineHeight: '1.5',
        color: TOOL_TEXT,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'monospace',
        maxHeight: '200px',
        overflowY: 'auto',
      };

      return (
        <div style={createToolCardStyle()}>
          <div style={headerStyle} onClick={() => setIsExpanded(!isExpanded)}>
            {summaryLine}
            <span style={{
              fontSize: '10px',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              opacity: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </div>
          {isExpanded && <div style={contentStyle}>{message.text}</div>}
        </div>
      );
    }

    return <div style={compactStyle}>{summaryLine}</div>;
  }

  // list_directory: custom "Listdirectory /path" style
  if (message.tool_name === 'list_directory') {
    const isError = isToolError;
    const ldArgs = message.tool_args || {};
    const ldPathFromArgs = (ldArgs.path as string | undefined) || '';
    let ldPath = ldPathFromArgs;
    if (!ldPath) {
      const match = message.text.match(/目录内容\s*\((.+?)\)\s*:/);
      if (match) ldPath = match[1];
    }
    const ldShortPath = (() => {
      if (!ldPath) return '';
      const segs = ldPath.replace(/\\/g, '/').split('/').filter(Boolean);
      const tail = segs.slice(-2).join('/');
      return tail ? `~/${tail}` : '';
    })();
    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Listdirectory{ldShortPath ? ` ${ldShortPath}` : ''}
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // create_folder: custom "Create folderName folder" style
  if (message.tool_name === 'create_folder') {
    const isError = isToolError;
    const cfArgs = message.tool_args || {};
    const cfPathFromArgs = (cfArgs.path as string | undefined) || '';
    let cfPath = cfPathFromArgs;
    if (!cfPath) {
      const match = message.text.match(/成功创建文件夹:\s*(.+?)(?:\n|$)/);
      if (match) cfPath = match[1].trim();
    }
    const folderName = cfPath.split(/[/\\]/).filter(Boolean).pop() || cfPath || 'folder';

    const compactStyle = createCompactStyle('8px');

    return (
      <div style={compactStyle}>
        <span>
          Create <span style={{ color: TOOL_TEXT }}>{folderName}</span> folder
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // get_file_tree: custom "File tree ~/a/b · D: x · F: y · Depth: n" style
  if (message.tool_name === 'get_file_tree') {
    const isError = isToolError;
    const ftArgs = message.tool_args || {};
    const ftRootFromArgs =
      (ftArgs.root_path as string | undefined) ||
      (ftArgs.rootPath as string | undefined) ||
      (ftArgs.path as string | undefined) ||
      '';
    let ftRoot = ftRootFromArgs;
    if (!ftRoot) {
      const match = message.text.match(/项目根目录:\s*(.+?)(?:\n|$)/);
      if (match) ftRoot = match[1].trim();
    }
    const ftShortPath = (() => {
      if (!ftRoot) return '';
      const segs = ftRoot.replace(/\\/g, '/').split('/').filter(Boolean);
      const tail = segs.slice(-2).join('/');
      return tail ? `~/${tail}` : '';
    })();
    let dirCount: number | null = null;
    let fileCount: number | null = null;
    const totalMatch = message.text.match(/总计:\s*(\d+)\s*个目录(?:\s*,\s*(\d+)\s*个文件)?/);
    if (totalMatch) {
      dirCount = parseInt(totalMatch[1], 10);
      if (totalMatch[2]) fileCount = parseInt(totalMatch[2], 10);
    }
    const depth =
      (ftArgs.max_depth as number | undefined) ??
      (ftArgs.maxDepth as number | undefined) ??
      3;

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          File tree{ftShortPath ? ` ${ftShortPath}` : ''}
          {dirCount !== null && (
            <span style={{ color: TOOL_TEXT }}> · D: {dirCount}</span>
          )}
          {fileCount !== null && (
            <span style={{ color: TOOL_TEXT }}> · F: {fileCount}</span>
          )}
          <span style={{ color: TOOL_TEXT_SUBTLE }}> · Depth: {depth}</span>
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // read_terminal_output: compact "Output · <terminal_id> · <N> lines" with expandable content
  if (message.tool_name === 'read_terminal_output') {
    const isError = isToolError;
    const rtoArgs = message.tool_args || {};
    const terminalId = (rtoArgs.terminal_id as string | undefined) || '';
    const shortId = terminalId.length > 16 ? terminalId.slice(0, 16) + '…' : terminalId;

    // 从输出文本中提取实际内容（去掉前缀行如 "Terminal output:" 或 "Background command..."）
    const outputText = message.text
      .replace(/^Terminal output:\s*\n*/i, '')
      .replace(/^Background command (?:completed|still running)[^.]*\.\s*\n*/i, '');
    const outputLines = outputText.trim() ? outputText.split('\n').length : 0;

    const compactStyle = createCompactStyle();

    // 有输出内容时，显示可展开的卡片
    if (outputLines > 0) {
      const headerStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: '12px',
        color: TOOL_TEXT_MUTED,
      };

      const contentStyle: CSSProperties = {
        marginTop: '6px',
        paddingLeft: '2px',
        fontSize: '12px',
        lineHeight: '1.5',
        color: TOOL_TEXT,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'monospace',
        maxHeight: '200px',
        overflowY: 'auto',
      };

      return (
        <div style={createToolCardStyle()}>
          <div
            style={headerStyle}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span>
              Output
              {shortId && <span style={{ color: TOOL_TEXT }}> · {shortId}</span>}
              <span style={{ color: TOOL_TEXT_SUBTLE }}> · {outputLines} lines</span>
              {isError && <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>}
            </span>
            <span style={{
              fontSize: '10px',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              opacity: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </div>
          {isExpanded && (
            <div style={contentStyle}>{outputText}</div>
          )}
        </div>
      );
    }

    // 无输出时，紧凑一行
    return (
      <div style={compactStyle}>
        <span>
          Output
          {shortId && <span style={{ color: TOOL_TEXT }}> · {shortId}</span>}
          <span style={{ color: TOOL_TEXT_SUBTLE }}> · No output</span>
          {isError && <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>}
        </span>
      </div>
    );
  }

  // list_bg_tasks: background task listing
  if (message.tool_name === 'list_bg_tasks') {
    const isError = isToolError;
    const summary = summarizeListBgTasks(message.text);
    const compactStyle = createCompactStyle();

    const summaryLine = (
      <span>
        Background tasks
        {summary.empty ? (
          <span style={{ color: TOOL_TEXT_SUBTLE }}> · none</span>
        ) : (
          <>
            <span style={{ color: TOOL_TEXT }}> · {summary.total} total</span>
            {summary.running > 0 && (
              <span style={{ color: TOOL_WARNING }}> · {summary.running} running</span>
            )}
            {summary.completed > 0 && (
              <span style={{ color: TOOL_SUCCESS }}> · {summary.completed} completed</span>
            )}
          </>
        )}
        {isError && <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>}
      </span>
    );

    if (!summary.empty && summary.tasks.length > 0) {
      const headerStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: '12px',
        color: TOOL_TEXT_MUTED,
      };
      const entryStyle: CSSProperties = {
        marginTop: '4px',
        fontSize: '12px',
        lineHeight: '1.5',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        overflow: 'hidden',
      };

      return (
        <div style={createToolCardStyle()}>
          <div style={headerStyle} onClick={() => setIsExpanded(!isExpanded)}>
            {summaryLine}
            <span style={{
              fontSize: '10px',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              opacity: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </div>
          {isExpanded && summary.tasks.map((task) => {
            const isRunning = task.status === 'running';
            return (
              <div key={task.id} style={entryStyle}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: '999px',
                  background: isRunning ? TOOL_WARNING_BG : TOOL_SUCCESS_BG,
                  color: isRunning ? TOOL_WARNING : TOOL_SUCCESS,
                  fontSize: '10px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  userSelect: 'none',
                  flexShrink: 0,
                }}>
                  {isRunning ? 'RUN' : 'DONE'}
                </span>
                <span style={{ color: TOOL_TEXT, flexShrink: 0 }}>{shortenId(task.id)}</span>
                <span style={{
                  color: TOOL_TEXT_SUBTLE,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {task.command}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    return <div style={compactStyle}>{summaryLine}</div>;
  }

  // kill_bg_task: terminate background task
  if (message.tool_name === 'kill_bg_task') {
    const isError = isToolError;
    const summary = summarizeKillBgTask(message.text, message.tool_args);
    const shortId = summary.taskId ? shortenId(summary.taskId) : 'task';

    return (
      <div style={createCompactStyle()}>
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 6px',
            borderRadius: '999px',
            background: TOOL_ERROR_BG,
            color: TOOL_ERROR,
            fontSize: '10px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            userSelect: 'none',
          }}>
            KILL
          </span>
          <span style={{
            color: TOOL_TEXT,
            background: TOOL_SURFACE_SOFT,
            padding: '2px 6px',
            borderRadius: '6px',
          }}>
            {shortId}
          </span>
          {summary.terminated && !isError && (
            <span style={{ color: TOOL_TEXT_SUBTLE }}>terminated</span>
          )}
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>✘</span>
          )}
      </div>
    );
  }

  // get_symbol_definition: custom "Symbol: <name> · <type> · ~/<path>:<line>" style
  if (message.tool_name === 'sym' || message.tool_name === 'get_symbol_definition') {
    const isError = isToolError;
    const gsArgs = message.tool_args || {};
    const nameFromArgs = (gsArgs.symbol_name as string | undefined) || '';

    const nameMatch = message.text.match(/symbol_name\s*[:：]\s*(.+?)(?:\n|$)/i);
    const typeMatch = message.text.match(/definition_type\s*[:：]\s*(.+?)(?:\n|$)/i);
    const pathMatch = message.text.match(/resolved_path\s*[:：]\s*(.+?)(?:\n|$)/i);
    const lineMatch = message.text.match(/definition_line\s*[:：]\s*(\d+)/i);

    const name = nameFromArgs || (nameMatch ? nameMatch[1].trim() : '') || 'symbol';
    const defType = typeMatch ? typeMatch[1].trim() : '';
    const rawPath = pathMatch ? pathMatch[1].trim() : '';
    const line = lineMatch ? lineMatch[1] : '';

    const shortPath = (() => {
      if (!rawPath) return '';
      const segs = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
      const tail = segs.slice(-2).join('/');
      return tail ? `~/${tail}` : '';
    })();

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Symbol: <span style={{ color: TOOL_TEXT }}>{name}</span>
          {defType && <span style={{ color: TOOL_TEXT_SUBTLE }}> · {defType}</span>}
          {shortPath && (
            <span style={{ color: TOOL_TEXT_SUBTLE }}>
              {' '}· {shortPath}{line ? `:${line}` : ''}
            </span>
          )}
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // get_git_diff: custom "Git diff · ~/<path> · +x −y · z files" style
  if (message.tool_name === 'get_git_diff') {
    const isError = isToolError;
    const gdArgs = message.tool_args || {};
    const filePathFromArgs = (gdArgs.file_path as string | undefined) || '';
    const repoPathFromArgs = (gdArgs.repo_path as string | undefined) || '';
    const maxLines = (gdArgs.max_lines as number | undefined) || null;

    const addMatch = message.text.match(/\+(\d+)\s*行/);
    const delMatch = message.text.match(/-(\d+)\s*行/);
    const filesMatch = message.text.match(/变更文件:\s*(\d+)\s*个/);

    const added = addMatch ? parseInt(addMatch[1], 10) : null;
    const removed = delMatch ? parseInt(delMatch[1], 10) : null;
    const files = filesMatch ? parseInt(filesMatch[1], 10) : null;

    const rawPath = filePathFromArgs || repoPathFromArgs;
    const shortPath = (() => {
      if (!rawPath) return '';
      const segs = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
      const tail = segs.slice(-2).join('/');
      return tail ? `~/${tail}` : '';
    })();

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Git diff
          {shortPath && <span style={{ color: TOOL_TEXT_SUBTLE }}> · {shortPath}</span>}
          {added !== null && (
            <span style={{ color: TOOL_SUCCESS }}> · +{added}</span>
          )}
          {removed !== null && (
            <span style={{ color: TOOL_ERROR }}> −{removed}</span>
          )}
          {files !== null && (
            <span style={{ color: TOOL_TEXT }}> · {files} files</span>
          )}
          {maxLines && <span style={{ color: TOOL_TEXT_SUBTLE }}> · (truncated)</span>}
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // undo_changes: custom "Undo changes · <restored> restored · <skipped> skipped" style
  if (message.tool_name === 'undo_changes') {
    const isError = isToolError;
    const restoredMatch =
      message.text.match(/已恢复的文件\s*[（(]?\s*(\d+)\s*个/) ||
      message.text.match(/成功撤销了\s*(\d+)\s*个文件/);
    const skippedMatch = message.text.match(/跳过的文件\s*[（(]?\s*(\d+)\s*个/);
    let restored = restoredMatch ? parseInt(restoredMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
    if (!restored) {
      const listMatches = message.text.match(/^\s*[✓√]\s+.+$/gm);
      if (listMatches) restored = listMatches.length;
    }

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Undo changes
          <span style={{ color: TOOL_TEXT }}> · {restored} restored</span>
          <span style={{ color: TOOL_TEXT_SUBTLE }}> · {skipped} skipped</span>
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  if (message.tool_name === 'web_search') {
    return <WebSearchToolResultCard message={message} />;
  }

  // fetch / control_browser: use BrowserToolResultCard
  if (
    message.tool_name === 'fetch'
    || message.tool_name === 'fetch_web_content'
    || message.tool_name === 'control_browser'
    || message.tool_name === 'browser'
  ) {
    return <BrowserToolResultCard message={message} />;
  }

  if (
    message.tool_name === 'graph_index'
    || message.tool_name === 'graph_query'
    || message.tool_name === 'graph_trace'
  ) {
    return <GraphToolResultCard message={message} />;
  }

  // Task: custom "Task · <type> · <status>" style
  if (message.tool_name === 'Task') {
    const isError = isToolError;
    const tArgs = message.tool_args || {};
    const taskType =
      (tArgs.task_type as string | undefined) ||
      (tArgs.type as string | undefined) ||
      (tArgs.agent_type as string | undefined) ||
      '';
    const statusMatch = message.text.match(/\b(completed|complete|failed|running|success|succeeded)\b/i);
    const status = statusMatch
      ? statusMatch[1].toLowerCase()
      : (isError ? 'failed' : 'completed');

    const compactStyle = createCompactStyle();

    return (
      <div style={compactStyle}>
        <span>
          Task
          {taskType && <span style={{ color: TOOL_TEXT }}> · {taskType}</span>}
          {status && <span style={{ color: TOOL_TEXT_SUBTLE }}> · {status}</span>}
          {isError && (
            <span style={{ color: TOOL_ERROR, marginLeft: '6px' }}>❌</span>
          )}
        </span>
      </div>
    );
  }

  // TodoWrite: summary header + in-progress items, expandable pending/completed
  if (message.tool_name === 'todo' || message.tool_name === 'TodoWrite') {
    const isError = isToolError;

    const args = message.tool_args as
      | { todos?: Array<{ id?: string; content: string; status: string }> }
      | undefined;
    const todos = args?.todos || [];

    const isInProgress = (status: string) =>
      status === 'in_progress' || status === 'in-progress' || status === 'inprogress';
    const isCompleted = (status: string) => status === 'completed';

    const inProgressItems = todos.filter((item) => isInProgress(item.status));
    const pendingItems = todos.filter((item) => !isInProgress(item.status) && !isCompleted(item.status));
    const completedItems = todos.filter((item) => isCompleted(item.status));
    const hasHidden = pendingItems.length > 0 || completedItems.length > 0;

    const headerStyle: CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: hasHidden ? 'pointer' : 'default',
      userSelect: 'none',
      fontSize: '12px',
      color: TOOL_TEXT_MUTED,
    };

    const activeRowStyle: CSSProperties = {
      marginTop: '4px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      fontSize: '12px',
      lineHeight: 1.45,
      color: TOOL_TEXT,
    };

    const hiddenSectionStyle: CSSProperties = {
      marginTop: '8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    };

    const hiddenRowStyle: CSSProperties = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      fontSize: '12px',
      lineHeight: 1.45,
      color: TOOL_TEXT_MUTED,
    };

    const renderHiddenGroup = (
      label: string,
      items: Array<{ id?: string; content: string; status: string }>,
      tone: 'muted' | 'success'
    ) => (
      <div key={label} style={hiddenSectionStyle}>
        <div style={{ fontSize: '11px', color: tone === 'success' ? TOOL_SUCCESS : TOOL_TEXT_SUBTLE }}>
          {label} · {items.length}
        </div>
        {items.map((item, index) => (
          <div key={item.id || `${label}-${index}`} style={hiddenRowStyle}>
            <span style={{
              flexShrink: 0,
              width: '6px',
              height: '6px',
              marginTop: '6px',
              borderRadius: '50%',
              background: tone === 'success' ? TOOL_SUCCESS : TOOL_TEXT_SUBTLE,
              opacity: tone === 'success' ? 0.85 : 0.55,
            }} />
            <span style={{
              flex: 1,
              color: tone === 'success' ? TOOL_TEXT_SUBTLE : TOOL_TEXT_MUTED,
              textDecoration: tone === 'success' ? 'line-through' : 'none',
            }}>
              {item.content}
            </span>
          </div>
        ))}
      </div>
    );

    const renderInProgressRow = (
      item: { id?: string; content: string; status: string },
      index: number,
      marginTop = '0'
    ) => (
      <div key={item.id || `in-progress-${index}`} style={{ ...activeRowStyle, marginTop }}>
        <TodoInProgressIndicator />
        <span style={{ flex: 1, color: TOOL_TEXT }}>{item.content}</span>
      </div>
    );

    return (
      <div style={createToolCardStyle()}>
        {!isError && inProgressItems.length > 0 && hasHidden && (
          <div
            style={headerStyle}
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid="todo-expand-toggle"
            aria-label="Toggle todo details"
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {inProgressItems.map((item, index) => renderInProgressRow(item, index, index === 0 ? '0' : '4px'))}
            </div>
            <span style={{
              fontSize: '10px',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              opacity: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              marginTop: '2px',
              flexShrink: 0,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </div>
        )}

        {!isError && inProgressItems.length > 0 && !hasHidden && (
          <div>
            {inProgressItems.map((item, index) => renderInProgressRow(item, index, index === 0 ? '0' : '4px'))}
          </div>
        )}

        {!isError && !inProgressItems.length && todos.length === 0 && (
          <div style={{ ...activeRowStyle, marginTop: '4px', color: TOOL_TEXT_SUBTLE }}>
            {t.todo.noItems}
          </div>
        )}

        {!isError && isExpanded && hasHidden && (
          <div>
            {pendingItems.length > 0 && renderHiddenGroup(t.todo.pending, pendingItems, 'muted')}
            {completedItems.length > 0 && renderHiddenGroup(t.todo.completed, completedItems, 'success')}
          </div>
        )}
      </div>
    );
  }

  if (message.tool_name === 'ask' || message.tool_name === 'ask_user_question') {
    const args = message.tool_args as { questions?: Array<{ header: string; question: string }> } | undefined;
    return (
      <AskToolResultCard
        isError={isToolError}
        errorText={message.text}
        questions={args?.questions}
        outputText={message.text}
      />
    );
  }

  // skill / load_skill: compact "Load skill · <name> · <scope>" style
  if (message.tool_name === 'skill' || message.tool_name === 'load_skill') {
    const isError = isToolError;
    const lsArgs = message.tool_args || {};
    const skillName = (lsArgs.skill_name as string | undefined) || (lsArgs.name as string | undefined) || '';

    // Extract scope from output: <skill name="..." scope="global|project">
    let scope: string | null = null;
    const scopeMatch = message.text.match(/<skill\s+[^>]*scope="(\w+)"/);
    if (scopeMatch) {
      scope = scopeMatch[1];
    }

    const compactStyle = createCompactStyle();

    const scopeBadge = scope && !isError ? (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: '999px',
        fontSize: '10px',
        letterSpacing: '0.04em',
        userSelect: 'none',
        background: scope === 'project' ? 'rgba(74, 222, 128, 0.12)' : 'rgba(168, 162, 255, 0.12)',
        color: scope === 'project' ? 'rgba(74, 222, 128, 0.85)' : 'rgba(168, 162, 255, 0.85)',
      }}>
        {scope === 'project' ? 'PROJ' : 'GLOBAL'}
      </span>
    ) : null;

    return (
      <div style={compactStyle}>
        <span>
          Load skill{skillName && <span style={{ color: TOOL_TEXT }}> · {skillName}</span>}
        </span>
        {scopeBadge}
        {isError && (
          <span style={{ color: TOOL_ERROR, marginLeft: '4px' }}>✘</span>
        )}
      </div>
    );
  }

  // Detect error/success from content
  if (approvalOutcome) {
    const cleanToolName = formatToolDisplayName(message.tool_name);
    const summary = message.approvalSummary;
    const compactStyle = createCompactStyle();

    return wrapCompactRow(
      compactStyle,
      <>
        <span style={{ color: TOOL_TEXT_MUTED }}>{cleanToolName}</span>
        {summary?.label && (
          <span style={{ color: TOOL_TEXT_SUBTLE }}>{summary.label}</span>
        )}
      </>
    );
  }

  const isError = isToolError;
  const cleanToolName = formatToolDisplayName(message.tool_name);
  const accentColor = isError ? TOOL_ERROR : TOOL_SUCCESS;
  const badgeBg = isError ? TOOL_ERROR_BG : TOOL_SUCCESS_BG;
  const badgeColor = isError ? TOOL_ERROR : TOOL_SUCCESS;

  const containerStyle: CSSProperties = {
    ...TOOL_RESULT_WIDTH,
    marginBottom: compactMarginBottom,
  };

  const cardStyle: CSSProperties = {
    ...createToolCardStyle('0'),
    borderRadius: '8px',
    overflow: 'hidden',
    background: isError ? TOOL_ERROR_BG : TOOL_SURFACE_SOFT,
    border: `1px solid ${TOOL_BORDER_SOFT}`,
    borderLeft: `3px solid ${accentColor}`,
  };

  const headerStyle: CSSProperties = {
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background 0.15s',
  };

  const truncatedText =
    message.text.length > 500 ? message.text.slice(0, 500) + '...' : message.text;

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div
          style={headerStyle}
          onClick={() => setIsExpanded(!isExpanded)}
          onMouseEnter={(e) => (e.currentTarget.style.background = TOOL_HOVER)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 500,
              color: TOOL_TEXT_MUTED,
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {cleanToolName}
            </span>
            <span style={{
              fontSize: '10px',
              fontWeight: 500,
              color: badgeColor,
              background: badgeBg,
              padding: '1px 8px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              {isError ? `✘ ${t.common.failed}` : `✔ ${t.common.completed}`}
            </span>
          </div>
          <span
            style={{
              fontSize: '10px',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              opacity: 0.5,
              color: TOOL_TEXT_SUBTLE,
              flexShrink: 0,
              marginLeft: '8px',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
        {isExpanded && (
          <div style={{ padding: '0 14px 12px', borderTop: `1px solid ${TOOL_BORDER_SOFT}` }}>
            <div
              style={{
                marginTop: '10px',
                padding: '10px 12px',
                fontSize: '12px',
                lineHeight: '1.6',
                color: TOOL_TEXT,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'monospace',
                maxHeight: '200px',
                overflowY: 'auto',
                background: TOOL_SURFACE_SOFT,
                borderRadius: '6px',
              }}
            >
              {truncatedText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default ToolResultMessage;
