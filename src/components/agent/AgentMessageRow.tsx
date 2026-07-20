import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThinkingBlock from './ThinkingBlock';
import ToolResultMessage from './ToolResultMessage';
import ProviderSwitchNotice from './ProviderSwitchNotice';
import ToolActivityRow, { ToolActivityChildren } from './ToolActivityRow';
import { markdownComponents, cleanupFileTree } from '../shared/MarkdownRenderers';
import { lightMarkdownComponents } from '../shared/LightMarkdownRenderer';
import { normalizeAssistantMarkdown } from '../../utils/assistantMarkdownNormalizer';
import { stripStrayThinkTags } from '../../utils/thinkingExtractor';
import type { ChatMessage } from '../../types/chat';
import CompactBoundaryCard from '../shared/CompactBoundaryCard';
import UserMessageBubble from './UserMessageBubble';

export type AgentGroupedItem =
  | { kind: 'msg'; message: ChatMessage }
  | { kind: 'readGroup'; messages: ChatMessage[] }
  | { kind: 'deleteGroup'; messages: ChatMessage[] }
  | { kind: 'plan'; id: string };

interface AgentMessageRowProps {
  item: AgentGroupedItem;
  expandedThinkingIds: Set<string>;
  thinkingBlockAutoExpand: boolean;
  streamingContinuingLabel: string;
  onToggleThinking: (messageId: string) => void;
  onApproveTool?: (messageId: string) => void;
  onRejectTool?: (messageId: string) => void;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  /** Edit + resend a user message (rolls back later file changes / AI output). */
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  userMessageEditDisabled?: boolean;
  planSlot?: React.ReactNode;
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

function ReadGroupRow({ messages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ToolActivityRow
      verb="read"
      main={`${messages.length} files`}
      status="ok"
      expandable
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      detail={
        <ToolActivityChildren
          items={messages.map((msg) => ({
            id: msg.id,
            name: getReadDisplayName(msg).replace(/^Read\s+/, ''),
          }))}
        />
      }
    />
  );
}

function DeleteGroupRow({ messages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ToolActivityRow
      verb="del"
      main={`${messages.length} files`}
      status="error"
      expandable
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      detail={
        <ToolActivityChildren
          items={messages.map((msg) => ({
            id: msg.id,
            name: getDeleteDisplayName(msg),
          }))}
        />
      }
    />
  );
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
  onResendFromUserMessage,
  userMessageEditDisabled = false,
  planSlot,
}: AgentMessageRowProps) {
  if (item.kind === 'plan') {
    return (
      <div data-testid="plan-scroll-anchor" style={{ marginTop: 12, marginBottom: 8 }}>
        {planSlot}
      </div>
    );
  }

  if (item.kind === 'readGroup') {
    return <ReadGroupRow messages={item.messages} />;
  }

  if (item.kind === 'deleteGroup') {
    return <DeleteGroupRow messages={item.messages} />;
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
      <UserMessageBubble
        message={message}
        onUserMessageLayout={onUserMessageLayout}
        onResendFromUserMessage={onResendFromUserMessage}
        editDisabled={userMessageEditDisabled}
      />
    );
  }

  if (message.role === 'tool') {
    return (
      <div style={{ width: '100%', marginBottom: '1px' }}>
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
            padding: '2px 0',
            color: 'var(--text-secondary)',
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
            padding: 0,
            borderRadius: 0,
            backgroundColor: 'transparent',
            border: 'none',
            boxShadow: 'none',
            color: 'var(--text-primary)',
            lineHeight: '1.65',
            fontSize: '13px',
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
