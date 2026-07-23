import {
  memo,
  useState,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
} from 'react';
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
import CompactToolResultCard from './CompactToolResultCard';
import ToolApprovalBar, { ToolApprovalOutcomeLabel } from './ToolApprovalBar';
import ToolActivityRow, {
  ToolActivityChildren,
  ToolActivityDetailPre,
  ToolActivityPath,
  shortActivityPath,
  type ToolActivityMetaItem,
  type ToolActivityStatus,
} from './ToolActivityRow';
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
import {
  toolCardShell,
  toolCompactShell,
  TOOL_RESULT_WIDTH,
  formatToolDisplayName,
} from './toolResultLayout';
import { TodoInProgressIndicator } from './TodoInProgressIndicator';

function activityStatus(isError: boolean, isRunning = false): ToolActivityStatus {
  if (isRunning) return 'run';
  if (isError) return 'error';
  return 'ok';
}

function activityMeta(...parts: Array<string | null | undefined | false>): ToolActivityMetaItem[] {
  const items: ToolActivityMetaItem[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (items.length > 0) items.push({ kind: 'sep' });
    items.push({ kind: 'text', value: part });
  }
  return items;
}

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
const TOOL_WARNING = 'color-mix(in srgb, var(--text-warning) 88%, var(--text-primary))';
const TOOL_WARNING_BG = 'color-mix(in srgb, var(--text-warning) 14%, var(--bg-sidebar))';

/** Strip fenced code blocks before error heuristics — tool output often embeds source containing "failed", "error:", etc. */
function stripCodeFencesForErrorHeuristics(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

function matchesToolErrorSummaryHeuristics(text: string): boolean {
  const summary = stripCodeFencesForErrorHeuristics(text);
  return (
    summary.startsWith('❌') ||
    summary.includes('错误:') ||
    summary.includes('执行失败') ||
    summary.includes('编辑失败') ||
    summary.includes('无法写入') ||
    summary.includes('无法编辑') ||
    summary.includes('无法读取') ||
    summary.includes('无法删除') ||
    summary.includes('无法移动') ||
    summary.includes('文件不存在') ||
    summary.includes('缺少必需参数') ||
    summary.includes('参数无效') ||
    summary.includes('权限不足') ||
    summary.includes('权限被拒绝') ||
    summary.toLowerCase().includes('failed') ||
    summary.toLowerCase().includes('error:')
  );
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
  const compactMarginBottom = '1px';
  const createCompactStyle = (marginBottom = compactMarginBottom): CSSProperties => ({
    ...toolCompactShell(marginBottom),
    color: TOOL_TEXT_MUTED,
  });
  const createToolCardStyle = (marginBottom = dense ? '6px' : '1px'): CSSProperties =>
    toolCardShell(marginBottom);
  const fileReadTools = ['read', 'read_file', 'view_file', 'get_file_info', 'finfo'];
  const isFileReadTool = fileReadTools.includes(message.tool_name || '');
  const isWriteFileTool = message.tool_name === 'write' || message.tool_name === 'write_file';

  const isPendingApproval = message.approvalStatus === 'pending' && message.approvalSummary != null;
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
      approvalFooter = <ToolApprovalBar status={approvalOutcome} layout="footer" />;
    }

    // Clone the card element to inject footer + approvalStatus props
    if (isValidElement(card)) {
      return (
        <div style={{ ...TOOL_RESULT_WIDTH, marginBottom: compactMarginBottom }}>
          {cloneElement(
            card as React.ReactElement<{
              footer?: ReactNode;
              approvalStatus?: 'pending' | 'approved' | 'denied';
            }>,
            {
              footer: approvalFooter,
              approvalStatus,
            }
          )}
        </div>
      );
    }

    return <div style={{ ...TOOL_RESULT_WIDTH, marginBottom: compactMarginBottom }}>{card}</div>;
  };

  // 统一错误检测：优先使用结构化 isError 字段，兜底使用文本模式匹配（排除代码块内容）
  const isToolError =
    approvalOutcome === 'denied'
      ? false
      : message.isError === true ||
        (message.isError !== false &&
          !isPendingApproval &&
          matchesToolErrorSummaryHeuristics(message.text));

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
          {wrapCompactRow(
            createCompactStyle('0'),
            <>
              <span style={{ color: TOOL_TEXT_MUTED }}>{cleanToolName}</span>
              {summary?.label && <span style={{ color: TOOL_TEXT_SUBTLE }}>{summary.label}</span>}
            </>
          )}
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
    const size = typeof message.tool_args?.size === 'string' ? message.tool_args.size : undefined;
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
    const isRunning = message.isStreaming === true && !/<exit-code>/.test(message.text);
    const parsed = parseCommandExecOutput(message.text, message.tool_args, { isRunning });
    return wrapCommandCardRow(
      <ExecCommandCard dense={dense} parsed={parsed} isRunning={isRunning} isError={isToolError} />
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
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  color: TOOL_TEXT_MUTED,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {pendingToolName}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  color: pendingBadgeColor,
                  background: pendingBadgeBg,
                  padding: '1px 8px',
                  borderRadius: '10px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
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

  // File read tools: unified activity row
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

    let range: string | undefined;
    if (maxLines !== undefined) {
      const start = startLine ?? 1;
      range = `${start}–${start + maxLines - 1}`;
    } else if (startLine !== undefined) {
      range = `${startLine}+`;
    }

    return (
      <ToolActivityRow
        verb="read"
        main={<ToolActivityPath path={fileName} suffix={range} />}
        status={activityStatus(isToolError)}
        meta={activityMeta(range ? `${range} ln` : undefined)}
      />
    );
  }

  // write_file
  if (isWriteFileTool) {
    const args = message.tool_args || {};
    const pathFromArgs = args.path as string | undefined;
    const contentFromArgs = args.content as string | undefined;
    const isError = isToolError;

    let fileName = 'file';
    if (pathFromArgs) {
      fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
    } else {
      const pathMatch = message.text.match(/成功写入文件:\s*(.+?)(?:\n|$)/);
      if (pathMatch) {
        fileName = pathMatch[1].trim().split(/[/\\]/).pop() || pathMatch[1].trim();
      }
    }

    let addedLines = 0;
    if (contentFromArgs) {
      addedLines = contentFromArgs.split('\n').length;
    } else {
      const charMatch = message.text.match(/写入了\s*(\d+)\s*个字符/);
      if (charMatch) {
        addedLines = Math.max(1, Math.round(parseInt(charMatch[1], 10) / 40));
      }
    }

    const meta: ToolActivityMetaItem[] = [];
    if (!isError && addedLines > 0) {
      meta.push({ kind: 'text', value: `+${addedLines}`, tone: 'add' });
    }

    return (
      <ToolActivityRow
        verb="write"
        main={<ToolActivityPath path={fileName} />}
        status={activityStatus(isError)}
        meta={meta}
      />
    );
  }

  // edit_file
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
    const meta: ToolActivityMetaItem[] = [];
    if (!isError && addedLines > 0)
      meta.push({ kind: 'text', value: `+${addedLines}`, tone: 'add' });
    if (!isError && removedLines > 0) {
      if (meta.length) meta.push({ kind: 'sep' });
      meta.push({ kind: 'text', value: `-${removedLines}`, tone: 'del' });
    }

    return (
      <ToolActivityRow
        verb="edit"
        main={<ToolActivityPath path={fileName} />}
        status={activityStatus(isError)}
        meta={meta}
      />
    );
  }

  // delete_file
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

    return wrapCompactRow(
      {
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        marginBottom: compactMarginBottom,
      },
      <ToolActivityRow
        verb="del"
        main={<ToolActivityPath path={fileName} strike={approvalOutcome !== 'denied'} />}
        status={activityStatus(isError)}
      />
    );
  }

  // move_file
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
    const left = isSameDir ? src.name : shortPath(src);
    const right = isSameDir ? dst.name : shortPath(dst);

    return (
      <ToolActivityRow
        verb={isSameDir ? 'rename' : 'move'}
        main={
          <>
            {left}
            <span className="muted" style={{ color: 'var(--text-secondary)' }}>
              {' '}
              →{' '}
            </span>
            {right}
          </>
        }
        status={activityStatus(isError)}
      />
    );
  }

  // copy_file
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
    const left = isSameDir ? src.name : shortPath(src);
    const right = isSameDir ? dst.name : shortPath(dst);

    return (
      <ToolActivityRow
        verb="copy"
        main={
          <>
            {left}
            <span style={{ color: 'var(--text-secondary)' }}> → </span>
            {right}
          </>
        }
        status={activityStatus(isError)}
      />
    );
  }

  // search_files
  if (message.tool_name === 'search_files') {
    const isError = isToolError;
    const sfArgs = message.tool_args || {};
    const pattern =
      (sfArgs.query as string | undefined) ||
      (sfArgs.pattern as string | undefined) ||
      (sfArgs.glob as string | undefined) ||
      '';
    let fileCount = 0;
    const countMatch = message.text.match(/找到\s*(\d+)\s*个匹配文件/);
    if (countMatch) {
      fileCount = parseInt(countMatch[1], 10);
    } else if (!isError) {
      fileCount = (message.text.match(/^- /gm) || []).length;
    }

    return (
      <ToolActivityRow
        verb="glob"
        main={
          pattern ? `"${pattern}"` : <span style={{ color: 'var(--text-secondary)' }}>files</span>
        }
        status={activityStatus(isError)}
        meta={activityMeta(`${fileCount}`)}
      />
    );
  }

  // search_content
  if (message.tool_name === 'search_content') {
    const isError = isToolError;
    const scArgs = message.tool_args || {};
    const query =
      (scArgs.query as string | undefined) || (scArgs.pattern as string | undefined) || '';
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
      if (fileCountMatch) matchCount = parseInt(fileCountMatch[1], 10);
    }
    if (!matchCount && !isError) {
      matchCount = (message.text.match(/^📄 /gm) || []).length;
    }

    return (
      <ToolActivityRow
        verb="grep"
        main={
          query ? `"${query}"` : <span style={{ color: 'var(--text-secondary)' }}>content</span>
        }
        status={activityStatus(isError)}
        meta={activityMeta(`${matchCount}`)}
      />
    );
  }

  // search_both
  if (message.tool_name === 'search_both') {
    const isError = isToolError;
    const summary = summarizeSearchBoth(message.text, message.tool_args);
    const queryLabel = summary.query ? `"${summary.query}"` : 'both';
    const meta = activityMeta(
      summary.noMatches ? '0' : undefined,
      !summary.noMatches && summary.fileCount != null && summary.fileCount > 0
        ? `${summary.fileCount} files`
        : undefined,
      !summary.noMatches && summary.placeCount != null && summary.placeCount > 0
        ? `${summary.placeCount} places`
        : undefined
    );

    if (summary.expandable) {
      return (
        <ToolActivityRow
          verb="grep"
          main={queryLabel}
          status={activityStatus(isError)}
          meta={meta}
          expandable
          expanded={isExpanded}
          onToggle={() => setIsExpanded((v) => !v)}
          detail={<ToolActivityDetailPre>{message.text}</ToolActivityDetailPre>}
        />
      );
    }

    return (
      <ToolActivityRow verb="grep" main={queryLabel} status={activityStatus(isError)} meta={meta} />
    );
  }

  // list_directory
  if (message.tool_name === 'list_directory') {
    const isError = isToolError;
    const ldArgs = message.tool_args || {};
    const ldPathFromArgs = (ldArgs.path as string | undefined) || '';
    let ldPath = ldPathFromArgs;
    if (!ldPath) {
      const match = message.text.match(/目录内容\s*\((.+?)\)\s*:/);
      if (match) ldPath = match[1];
    }
    const ldShortPath = shortActivityPath(ldPath) || ldPath || '.';
    let entryCount: number | undefined;
    const countMatch =
      message.text.match(/共\s*(\d+)\s*项/) || message.text.match(/(\d+)\s*(?:items?|entries)/i);
    if (countMatch) entryCount = parseInt(countMatch[1], 10);
    else if (!isError) {
      const lines = message.text.split('\n').filter((l) => l.trim() && !l.includes('目录内容'));
      if (lines.length > 0) entryCount = lines.length;
    }

    return (
      <ToolActivityRow
        verb="list"
        main={<ToolActivityPath path={ldShortPath} />}
        status={activityStatus(isError)}
        meta={activityMeta(entryCount != null ? String(entryCount) : undefined)}
      />
    );
  }

  // create_folder
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

    return (
      <ToolActivityRow
        verb="mkdir"
        main={<ToolActivityPath path={folderName} />}
        status={activityStatus(isError)}
      />
    );
  }

  // get_file_tree
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
    const ftShortPath = shortActivityPath(ftRoot) || ftRoot || '.';
    let dirCount: number | null = null;
    let fileCount: number | null = null;
    const totalMatch = message.text.match(/总计:\s*(\d+)\s*个目录(?:\s*,\s*(\d+)\s*个文件)?/);
    if (totalMatch) {
      dirCount = parseInt(totalMatch[1], 10);
      if (totalMatch[2]) fileCount = parseInt(totalMatch[2], 10);
    }
    const depth =
      (ftArgs.max_depth as number | undefined) ?? (ftArgs.maxDepth as number | undefined) ?? 3;
    const total =
      dirCount != null || fileCount != null
        ? String((dirCount || 0) + (fileCount || 0) || dirCount || fileCount || 0)
        : undefined;

    return (
      <ToolActivityRow
        verb="tree"
        main={<ToolActivityPath path={ftShortPath} suffix={`depth ${depth}`} />}
        status={activityStatus(isError)}
        meta={activityMeta(total)}
      />
    );
  }

  // read_terminal_output
  if (message.tool_name === 'read_terminal_output') {
    const isError = isToolError;
    const rtoArgs = message.tool_args || {};
    const terminalId = (rtoArgs.terminal_id as string | undefined) || '';
    const shortId = terminalId.length > 16 ? terminalId.slice(0, 16) + '…' : terminalId;
    const outputText = message.text
      .replace(/^Terminal output:\s*\n*/i, '')
      .replace(/^Background command (?:completed|still running)[^.]*\.\s*\n*/i, '');
    const outputLines = outputText.trim() ? outputText.split('\n').length : 0;

    if (outputLines > 0) {
      return (
        <ToolActivityRow
          verb="out"
          main={<ToolActivityPath path={shortId || 'terminal'} />}
          status={activityStatus(isError)}
          meta={activityMeta(`${outputLines} ln`)}
          expandable
          expanded={isExpanded}
          onToggle={() => setIsExpanded((v) => !v)}
          detail={<ToolActivityDetailPre>{outputText}</ToolActivityDetailPre>}
        />
      );
    }

    return (
      <ToolActivityRow
        verb="out"
        main={<ToolActivityPath path={shortId || 'terminal'} suffix="no output" />}
        status={activityStatus(isError)}
      />
    );
  }

  // list_bg_tasks
  if (message.tool_name === 'list_bg_tasks') {
    const isError = isToolError;
    const summary = summarizeListBgTasks(message.text);
    const meta = activityMeta(
      summary.empty ? 'none' : `${summary.total}`,
      !summary.empty && summary.running > 0 ? `${summary.running} run` : undefined,
      !summary.empty && summary.completed > 0 ? `${summary.completed} done` : undefined
    );

    if (!summary.empty && summary.tasks.length > 0) {
      return (
        <ToolActivityRow
          verb="bg"
          main="tasks"
          status={activityStatus(isError)}
          meta={meta}
          expandable
          expanded={isExpanded}
          onToggle={() => setIsExpanded((v) => !v)}
          detail={
            <ToolActivityChildren
              items={summary.tasks.map((task) => ({
                id: task.id,
                name: `${shortenId(task.id)}  ${task.command}`,
                meta: task.status === 'running' ? 'run' : 'done',
              }))}
            />
          }
        />
      );
    }

    return <ToolActivityRow verb="bg" main="tasks" status={activityStatus(isError)} meta={meta} />;
  }

  // kill_bg_task
  if (message.tool_name === 'kill_bg_task') {
    const isError = isToolError;
    const summary = summarizeKillBgTask(message.text, message.tool_args);
    const shortId = summary.taskId ? shortenId(summary.taskId) : 'task';

    return (
      <ToolActivityRow
        verb="kill"
        main={<ToolActivityPath path={shortId} />}
        status={activityStatus(isError)}
        meta={activityMeta(summary.terminated && !isError ? 'terminated' : undefined)}
      />
    );
  }

  // get_symbol_definition
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
    const shortPath = shortActivityPath(rawPath);
    const loc = shortPath ? `${shortPath}${line ? `:${line}` : ''}` : '';

    return (
      <ToolActivityRow
        verb="sym"
        main={<ToolActivityPath path={name} suffix={defType || undefined} />}
        status={activityStatus(isError)}
        meta={activityMeta(loc || undefined)}
      />
    );
  }

  // get_git_diff
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
    const shortPath = shortActivityPath(rawPath) || 'diff';
    const meta: ToolActivityMetaItem[] = [];
    if (added !== null) meta.push({ kind: 'text', value: `+${added}`, tone: 'add' });
    if (removed !== null) {
      if (meta.length) meta.push({ kind: 'sep' });
      meta.push({ kind: 'text', value: `-${removed}`, tone: 'del' });
    }
    if (files !== null) {
      if (meta.length) meta.push({ kind: 'sep' });
      meta.push({ kind: 'text', value: `${files} files` });
    }

    return (
      <ToolActivityRow
        verb="git"
        main={<ToolActivityPath path={shortPath} suffix={maxLines ? 'truncated' : undefined} />}
        status={activityStatus(isError)}
        meta={meta}
      />
    );
  }

  // undo_changes
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

    return (
      <ToolActivityRow
        verb="undo"
        main="changes"
        status={activityStatus(isError)}
        meta={activityMeta(`${restored} restored`, `${skipped} skipped`)}
      />
    );
  }

  if (message.tool_name === 'web_search') {
    return <WebSearchToolResultCard message={message} />;
  }

  // fetch / control_browser: use BrowserToolResultCard
  if (
    message.tool_name === 'fetch' ||
    message.tool_name === 'fetch_web_content' ||
    message.tool_name === 'control_browser' ||
    message.tool_name === 'browser'
  ) {
    return <BrowserToolResultCard message={message} />;
  }

  if (
    message.tool_name === 'graph_index' ||
    message.tool_name === 'graph_query' ||
    message.tool_name === 'graph_trace'
  ) {
    return <GraphToolResultCard message={message} />;
  }

  // Task (compact when subagents disabled)
  if (message.tool_name === 'Task') {
    const isError = isToolError;
    const tArgs = message.tool_args || {};
    const taskType =
      (tArgs.task_type as string | undefined) ||
      (tArgs.type as string | undefined) ||
      (tArgs.agent_type as string | undefined) ||
      '';
    const statusMatch = message.text.match(
      /\b(completed|complete|failed|running|success|succeeded)\b/i
    );
    const status = statusMatch ? statusMatch[1].toLowerCase() : isError ? 'failed' : 'completed';

    return (
      <ToolActivityRow
        verb="task"
        main={taskType || 'agent'}
        status={activityStatus(isError, status === 'running')}
        meta={activityMeta(status)}
      />
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
    const pendingItems = todos.filter(
      (item) => !isInProgress(item.status) && !isCompleted(item.status)
    );
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
        <div
          style={{ fontSize: '11px', color: tone === 'success' ? TOOL_SUCCESS : TOOL_TEXT_SUBTLE }}
        >
          {label} · {items.length}
        </div>
        {items.map((item, index) => (
          <div key={item.id || `${label}-${index}`} style={hiddenRowStyle}>
            <span
              style={{
                flexShrink: 0,
                width: '6px',
                height: '6px',
                marginTop: '6px',
                borderRadius: '50%',
                background: tone === 'success' ? TOOL_SUCCESS : TOOL_TEXT_SUBTLE,
                opacity: tone === 'success' ? 0.85 : 0.55,
              }}
            />
            <span
              style={{
                flex: 1,
                color: tone === 'success' ? TOOL_TEXT_SUBTLE : TOOL_TEXT_MUTED,
                textDecoration: tone === 'success' ? 'line-through' : 'none',
              }}
            >
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
              {inProgressItems.map((item, index) =>
                renderInProgressRow(item, index, index === 0 ? '0' : '4px')
              )}
            </div>
            <span
              style={{
                fontSize: '10px',
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                opacity: 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                alignSelf: 'flex-start',
                marginTop: '2px',
                flexShrink: 0,
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </div>
        )}

        {!isError && inProgressItems.length > 0 && !hasHidden && (
          <div>
            {inProgressItems.map((item, index) =>
              renderInProgressRow(item, index, index === 0 ? '0' : '4px')
            )}
          </div>
        )}

        {!isError && !inProgressItems.length && todos.length === 0 && (
          <div style={{ ...activeRowStyle, marginTop: '4px', color: TOOL_TEXT_SUBTLE }}>
            {t.todo.noItems}
          </div>
        )}

        {!isError && hasHidden && (
          <div
            style={{
              display: 'grid',
              gridTemplateRows: isExpanded ? '1fr' : '0fr',
              transition: 'grid-template-rows 0.25s ease',
            }}
            aria-hidden={!isExpanded}
          >
            <div
              style={{
                minHeight: 0,
                overflow: 'hidden',
                opacity: isExpanded ? 1 : 0,
                pointerEvents: isExpanded ? 'auto' : 'none',
                transition: 'opacity 0.18s ease',
              }}
            >
              {pendingItems.length > 0 && renderHiddenGroup(t.todo.pending, pendingItems, 'muted')}
              {completedItems.length > 0 &&
                renderHiddenGroup(t.todo.completed, completedItems, 'success')}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (message.tool_name === 'ask' || message.tool_name === 'ask_user_question') {
    const args = message.tool_args as
      | { questions?: Array<{ header: string; question: string }> }
      | undefined;
    return (
      <AskToolResultCard
        isError={isToolError}
        errorText={message.text}
        questions={args?.questions}
        outputText={message.text}
      />
    );
  }

  // skill / load_skill
  if (message.tool_name === 'skill' || message.tool_name === 'load_skill') {
    const isError = isToolError;
    const lsArgs = message.tool_args || {};
    const skillName =
      (lsArgs.skill_name as string | undefined) || (lsArgs.name as string | undefined) || 'skill';
    let scope: string | null = null;
    const scopeMatch = message.text.match(/<skill\s+[^>]*scope="(\w+)"/);
    if (scopeMatch) scope = scopeMatch[1];

    return (
      <ToolActivityRow
        verb="skill"
        main={<ToolActivityPath path={skillName} />}
        status={activityStatus(isError)}
        meta={activityMeta(
          scope === 'project' ? 'proj' : scope === 'global' ? 'global' : undefined
        )}
      />
    );
  }

  // Detect error/success from content
  if (approvalOutcome) {
    const cleanToolName = formatToolDisplayName(message.tool_name);
    const summary = message.approvalSummary;
    return wrapCompactRow(
      {
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        marginBottom: compactMarginBottom,
      },
      <ToolActivityRow
        verb="tool"
        main={
          <>
            {cleanToolName}
            {summary?.label ? (
              <span style={{ color: 'var(--text-secondary)' }}> {summary.label}</span>
            ) : null}
          </>
        }
        status="neutral"
      />
    );
  }

  const isError = isToolError;

  return (
    <CompactToolResultCard
      toolName={message.tool_name}
      text={message.text || ''}
      isError={isError}
    />
  );
});

export default ToolResultMessage;
