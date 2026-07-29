import { useState } from 'react';
import ToolResultMessage from './ToolResultMessage';
import ProviderSwitchNotice from './ProviderSwitchNotice';
import ToolActivityRow, { ToolActivityChildren } from './ToolActivityRow';
import ChatMessageBubble from '../chat/ChatMessageBubble';
import type { Message } from '../chat/types';
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
  thinkingBlockAutoExpand: boolean;
  onApproveTool?: (messageId: string) => void;
  onRejectTool?: (messageId: string) => void;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  /** Edit + resend a user message (rolls back later file changes / AI output). */
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  onForkFromUserMessage?: (messageId: string) => void | Promise<void>;
  userMessageEditDisabled?: boolean;
  userMessageForkDisabled?: boolean;
  planSlot?: React.ReactNode;
}

/** Map Agent ChatMessage → Chat Message so assistant UI is ChatMessageBubble (same path). */
function toChatBubbleMessage(message: ChatMessage): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.text || '',
    rawContent: message.rawContent,
    rawThinking: message.rawThinking,
    lastThinkingChunk: message.lastThinkingChunk,
    receivedThinkingChunks: message.receivedThinkingChunks,
    thinking: message.thinking,
    isThinking: message.isThinking,
    isStreaming: message.isStreaming,
    timestamp: message.createdAt,
    startTime: message.createdAt,
    firstChunkTime: message.firstChunkTime,
    firstContentTime: message.firstContentTime,
    endTime: message.endTime,
    thinkingStartedAt: message.thinkingStartedAt,
    thinkingEndedAt: message.thinkingEndedAt,
    attachments: message.attachments,
    tool_calls: message.tool_calls,
    tool_call_id: message.tool_call_id,
    tool_name: message.tool_name,
    tool_args: message.tool_args,
    isError: message.isError,
    slashCommand: message.slashCommand,
    uiNotice: message.uiNotice,
    compactBoundary: message.compactBoundary,
    compactSummary: message.compactSummary,
    compactMetadata: message.compactMetadata,
    executedTools: message.executedTools,
  };
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
    const pathMatch = m.text.match(/(?:已.*删除|已移入回收站|deleted|removed)[^:]*:\s*(.+?)$/im);
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
  thinkingBlockAutoExpand,
  onApproveTool,
  onRejectTool,
  onUserMessageLayout,
  onResendFromUserMessage,
  onForkFromUserMessage,
  userMessageEditDisabled = false,
  userMessageForkDisabled = false,
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

  if (message.role === 'user') {
    return (
      <UserMessageBubble
        message={message}
        onUserMessageLayout={onUserMessageLayout}
        onResendFromUserMessage={onResendFromUserMessage}
        onForkFromUserMessage={onForkFromUserMessage}
        editDisabled={userMessageEditDisabled}
        forkDisabled={userMessageForkDisabled}
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

  // Assistant: same ThinkingBlock expand/collapse path as Chat.
  return (
    <div id={`msg-${message.id}`} style={{ marginBottom: '8px' }}>
      <ChatMessageBubble
        message={toChatBubbleMessage(message)}
        autoExpandThinking={thinkingBlockAutoExpand}
      />
    </div>
  );
}
