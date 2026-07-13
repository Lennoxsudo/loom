import { convertFileSrc } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThinkingBlock from './ThinkingBlock';
import ToolResultMessage from './ToolResultMessage';
import ProviderSwitchNotice from './ProviderSwitchNotice';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { markdownComponents, cleanupFileTree } from '../shared/MarkdownRenderers';
import { lightMarkdownComponents } from '../shared/LightMarkdownRenderer';
import { normalizeAssistantMarkdown } from '../../utils/assistantMarkdownNormalizer';
import { stripStrayThinkTags } from '../../utils/thinkingExtractor';
import type { ChatMessage } from '../../types/chat';
import CompactBoundaryCard from '../shared/CompactBoundaryCard';

export type AgentGroupedItem =
  | { kind: 'msg'; message: ChatMessage }
  | { kind: 'readGroup'; messages: ChatMessage[] }
  | { kind: 'deleteGroup'; messages: ChatMessage[] };

interface AgentMessageRowProps {
  item: AgentGroupedItem;
  expandedThinkingIds: Set<string>;
  thinkingBlockAutoExpand: boolean;
  streamingContinuingLabel: string;
  onToggleThinking: (messageId: string) => void;
  onApproveTool?: (messageId: string) => void;
  onRejectTool?: (messageId: string) => void;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
}

function getReadDisplayName(m: ChatMessage) {
  const args = m.tool_args || {};
  const pathFromArgs = args.path as string | undefined;
  const startLine = args.start_line as number | undefined;
  const maxLines = args.max_lines as number | undefined;
  let fileName = 'file';
  if (pathFromArgs) {
    fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
  } else {
    const pathMatch = m.text.match(/(?:path|file)[:\s]+["']?([^"'\n\r]+)/i);
    const fileNameMatch = m.text.match(/([^/\\]+\.[a-zA-Z0-9]+)/);
    if (pathMatch) fileName = pathMatch[1].split(/[/\\]/).pop() || pathMatch[1];
    else if (fileNameMatch) fileName = fileNameMatch[1];
  }
  if (maxLines !== undefined) {
    const start = startLine ?? 1;
    return `Read ${fileName} ${start}-${start + maxLines - 1}`;
  }
  if (startLine !== undefined) return `Read ${fileName} ${startLine}+`;
  return `Read ${fileName}`;
}

function getDeleteDisplayName(m: ChatMessage) {
  const args = m.tool_args || {};
  const pathFromArgs = args.path as string | undefined;
  let fileName = 'file';
  if (pathFromArgs) {
    fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
  } else {
    const pathMatch = m.text.match(
      /(?:已.*删除|已移入回收站|deleted|removed)[^:]*:\s*(.+?)$/im
    );
    if (pathMatch) {
      const raw = pathMatch[1].trim();
      fileName = raw.split(/[/\\]/).pop() || raw;
    } else {
      const fileNameMatch = m.text.match(/([^/\\]+\.[a-zA-Z0-9]+)/);
      if (fileNameMatch) fileName = fileNameMatch[1];
    }
  }
  return fileName;
}

export default function AgentMessageRow({
  item,
  expandedThinkingIds,
  thinkingBlockAutoExpand,
  streamingContinuingLabel,
  onToggleThinking,
  onApproveTool,
  onRejectTool,
  onUserMessageLayout,
}: AgentMessageRowProps) {
  if (item.kind === 'readGroup') {
    return (
      <div style={{ marginBottom: '10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            fontSize: '12px',
            color: '#a0a0a0',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={(e) => {
            const list = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (!list) return;
            const hidden = list.style.display === 'none';
            list.style.display = hidden ? 'block' : 'none';
            const chevron = e.currentTarget.querySelector(
              '.read-list-chevron'
            ) as HTMLElement | null;
            if (chevron) {
              chevron.style.transform = hidden ? 'rotate(90deg)' : 'rotate(0deg)';
            }
          }}
        >
          <span
            className="read-list-chevron"
            style={{
              display: 'inline-flex',
              transform: 'rotate(0deg)',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
          <span>Read List ({item.messages.length} files)</span>
        </div>
        <div style={{ display: 'none', marginLeft: '16px', marginBottom: '4px' }}>
          {item.messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '4px',
                fontSize: '12px',
                color: '#a0a0a0',
              }}
            >
              <span>{getReadDisplayName(msg)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (item.kind === 'deleteGroup') {
    return (
      <div style={{ marginBottom: '10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            fontSize: '12px',
            color: '#fca5a5',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={(e) => {
            const list = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (!list) return;
            const hidden = list.style.display === 'none';
            list.style.display = hidden ? 'block' : 'none';
            const chevron = e.currentTarget.querySelector(
              '.delete-list-chevron'
            ) as HTMLElement | null;
            if (chevron) {
              chevron.style.transform = hidden ? 'rotate(90deg)' : 'rotate(0deg)';
            }
          }}
        >
          <span
            className="delete-list-chevron"
            style={{
              display: 'inline-flex',
              transform: 'rotate(0deg)',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
          <span>Delete List ({item.messages.length} files)</span>
        </div>
        <div style={{ display: 'none', marginLeft: '16px', marginBottom: '4px' }}>
          {item.messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px',
                fontSize: '12px',
                color: '#a0a0a0',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: '999px',
                  background: 'rgba(248, 113, 113, 0.12)',
                  color: '#fca5a5',
                  fontSize: '10px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                delete
              </span>
              <span
                style={{
                  color: '#e5e7eb',
                  background: 'rgba(255, 255, 255, 0.06)',
                  padding: '2px 6px',
                  borderRadius: '6px',
                  textDecoration: 'line-through',
                  textDecorationThickness: '1px',
                  textDecorationColor: 'rgba(248, 113, 113, 0.6)',
                }}
              >
                {getDeleteDisplayName(msg)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const message = item.message;
  if (message.uiNotice?.type === 'provider-switch') {
    return (
      <div id={`msg-${message.id}`} style={{ marginBottom: '8px' }}>
        <ProviderSwitchNotice notice={message.uiNotice} />
      </div>
    );
  }

  if (message.compactBoundary && message.compactMetadata) {
    return (
      <div id={`msg-${message.id}`}>
        <CompactBoundaryCard metadata={message.compactMetadata} />
      </div>
    );
  }

  if (message.compactSummary) {
    return (
      <div id={`msg-${message.id}`}>
        <CompactBoundaryCard
          metadata={{
            compactedAt: message.createdAt,
            compactType: 'auto',
            headMessageId: message.id,
            anchorMessageId: message.id,
            tailMessageId: message.id,
            originalMessageIds: [],
            summaryMessageId: message.id,
          }}
          summaryText={message.text}
          variant="summary"
        />
      </div>
    );
  }

  const isUser = message.role === 'user';
  const isActivelyStreaming = !!message.isStreaming;
  let displayText = message.text;
  let actualThinking = message.thinking || '';
  if (!isUser) {
    const leftoverThinkMatch =
      displayText.match(/<think[\s\S]*?>([\s\S]*?)<\/think>/i) ||
      displayText.match(/<thinking[\s\S]*?>([\s\S]*?)<\/thinking>/i) ||
      displayText.match(/思考开始[\s\S]*?思考结束/);
    if (leftoverThinkMatch) {
      displayText = displayText.replace(leftoverThinkMatch[0], '').trim();
    }
    displayText = stripStrayThinkTags(displayText);
    actualThinking = stripStrayThinkTags(actualThinking);
  }
  const isActivelyThinking =
    !!message.isStreaming && !message.thinkingEndedAt && !!message.isThinking;
  const hasThinking = !isUser && (isActivelyThinking || actualThinking.length > 0);
  const isThinkingExpanded =
    expandedThinkingIds.has(message.id) ||
    (thinkingBlockAutoExpand && !!message.isThinking && !!message.isStreaming);

  const normalizedAssistantText = isUser
    ? displayText
    : isActivelyStreaming
      ? displayText.replace(/^(?:\r?\n)+/, '')
      : normalizeAssistantMarkdown(displayText.replace(/^(?:\r?\n)+/, ''));
  const hasVisibleAssistantText = normalizedAssistantText.trim().length > 0;
  const showStreamingGap =
    !!message.isStreaming && !!message.thinkingEndedAt && !hasVisibleAssistantText;
  const showProcessingIndicator = !isUser && showStreamingGap;
  const processingIndicatorLabel = streamingContinuingLabel;

  if (isUser) {
    return (
      <div
        id={`msg-${message.id}`}
        ref={(element) => onUserMessageLayout?.(message.id, element)}
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'flex-start',
          gap: '6px',
          marginBottom: '8px',
        }}
      >
        <div
          style={{
            maxWidth: '75%',
            padding: '10px 14px',
            borderRadius: '14px 14px 4px 14px',
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            color: 'var(--text-inverse)',
            fontSize: '13px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
          }}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: message.text || message.fileAttachments?.length ? '8px' : '0',
              }}
            >
              {message.attachments.map((att) => (
                <img
                  key={att.id}
                  src={convertFileSrc(att.path)}
                  alt="Attachment"
                  style={{
                    maxHeight: '120px',
                    maxWidth: '100%',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    objectFit: 'cover',
                  }}
                />
              ))}
            </div>
          )}
          {message.fileAttachments && message.fileAttachments.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
                marginBottom: message.text ? '8px' : 0,
                whiteSpace: 'normal',
              }}
            >
              {message.fileAttachments.map((file) => (
                <div
                  key={file.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 7px',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '5px',
                    fontSize: '11px',
                    maxWidth: '200px',
                  }}
                >
                  <FileTypeIcon name={file.name} size={12} />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.name}
                  </span>
                </div>
              ))}
            </div>
          )}
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    return (
      <div style={{ width: '100%', marginBottom: '6px' }}>
        <ToolResultMessage
          message={message}
          onApproveTool={onApproveTool}
          onRejectTool={onRejectTool}
        />
      </div>
    );
  }

  if (!hasThinking && !hasVisibleAssistantText && !showProcessingIndicator) return null;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginBottom: '8px',
      }}
    >
      {showProcessingIndicator && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '4px 14px 14px 14px',
            backgroundColor: '#1e1e1e',
            border: '1px solid rgba(60, 60, 60, 0.4)',
            color: 'rgba(216, 216, 216, 0.75)',
            fontSize: '12px',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-color, #4a9eff)',
              opacity: 0.85,
            }}
          />
          {processingIndicatorLabel}
        </div>
      )}

      {hasThinking && (
        <ThinkingBlock
          thinking={actualThinking}
          isThinking={isActivelyThinking}
          thinkingStartedAt={message.thinkingStartedAt}
          thinkingEndedAt={message.thinkingEndedAt ?? message.firstContentTime}
          createdAt={message.createdAt}
          isExpanded={isThinkingExpanded}
          onToggle={() => onToggleThinking(message.id)}
        />
      )}

      {hasVisibleAssistantText && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '4px 14px 14px 14px',
            backgroundColor: '#1e1e1e',
            border: '1px solid rgba(60, 60, 60, 0.4)',
            color: '#d8d8d8',
            lineHeight: '1.65',
            fontSize: '13px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          }}
        >
          {isActivelyStreaming ? (
            // 流式时使用轻量级 Markdown 渲染器（无语法高亮，性能更优）
            <ReactMarkdown
              key={`md-${message.id}-streaming`}
              remarkPlugins={[remarkGfm]}
              components={lightMarkdownComponents}
            >
              {cleanupFileTree(normalizedAssistantText)}
            </ReactMarkdown>
          ) : (
            <ReactMarkdown
              key={`md-${message.id}-done`}
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {normalizedAssistantText}
            </ReactMarkdown>
          )}
        </div>
      )}
    </div>
  );
}
