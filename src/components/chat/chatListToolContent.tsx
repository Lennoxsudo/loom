import { memo, useState } from 'react';
import ToolResultMessage from '../agent/ToolResultMessage';
import ToolActivityRow, { ToolActivityChildren } from '../agent/ToolActivityRow';
import GraphToolResultCard from './GraphToolResultCard';
import ToolApprovalBar from '../agent/ToolApprovalBar';
import ToolApprovalShell from '../agent/ToolApprovalShell';
import approvalStyles from '../agent/ToolApprovalShell.module.css';
import type { ChatApprovalRequest, ChatApprovalSummary, Message } from './types';

export const CHAT_APPROVAL_TOOL_NAME = 'chat_approval_request';

function getApprovalRequest(message: Message): ChatApprovalRequest | null {
  if (message.tool_name !== CHAT_APPROVAL_TOOL_NAME || !message.tool_args) {
    return null;
  }

  const request = message.tool_args as unknown as Partial<ChatApprovalRequest>;
  if (
    typeof request.requestId !== 'string' ||
    !Array.isArray(request.summaries) ||
    !Array.isArray(request.toolCalls)
  ) {
    return null;
  }

  return {
    requestId: request.requestId,
    status:
      request.status === 'approved' || request.status === 'denied' ? request.status : 'pending',
    summaries: request.summaries as ChatApprovalSummary[],
    toolCalls: request.toolCalls,
    sourceAssistantMessageId:
      typeof request.sourceAssistantMessageId === 'string'
        ? request.sourceAssistantMessageId
        : undefined,
  };
}

function ChatApprovalCard({
  message,
  onApprove,
  onDeny,
}: {
  message: Message;
  onApprove: (requestId: string) => void | Promise<void>;
  onDeny: (requestId: string) => void | Promise<void>;
}) {
  const request = getApprovalRequest(message);
  if (!request) return null;

  const isPending = request.status === 'pending';
  const approvalStatus =
    request.status === 'approved' ? 'approved' : request.status === 'denied' ? 'denied' : 'pending';

  const shellMode =
    request.status === 'denied' ? 'denied' : request.status === 'approved' ? 'resolved' : 'pending';

  return (
    <ToolApprovalShell
      mode={shellMode}
      compact={false}
      footer={
        <ToolApprovalBar
          status={approvalStatus}
          layout="footer"
          onApprove={isPending ? () => void onApprove(request.requestId) : undefined}
          onReject={isPending ? () => void onDeny(request.requestId) : undefined}
        />
      }
    >
      <div className={approvalStyles.header}>
        <span className={approvalStyles.actionLabel}>
          {request.summaries[0]?.label || message.content}
        </span>
      </div>
      {request.summaries[0]?.detail && (
        <pre className={approvalStyles.detail}>{request.summaries[0].detail}</pre>
      )}
    </ToolApprovalShell>
  );
}

const FILE_READ_TOOLS = ['read', 'read_file', 'view_file', 'get_file_info', 'finfo'];

function isFileReadMsg(msg: Message): boolean {
  return msg.role === 'tool' && FILE_READ_TOOLS.includes(msg.tool_name || '');
}

function readDisplayName(msg: Message): string {
  const args = msg.tool_args || {};
  const pathFromArgs = args.path as string | undefined;
  const startLine = args.start_line as number | undefined;
  const maxLines = args.max_lines as number | undefined;

  let fileName = 'file';
  if (pathFromArgs) {
    fileName = pathFromArgs.split(/[/\\]/).pop() || pathFromArgs;
  } else {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const pathMatch = content.match(/(?:path|file)[:\s]+["']?([^"'\n\r]+)/i);
    const fileNameMatch = content.match(/([^/\\]+\.[a-zA-Z0-9]+)/);
    if (pathMatch) {
      fileName = pathMatch[1].split(/[/\\]/).pop() || pathMatch[1];
    } else if (fileNameMatch) {
      fileName = fileNameMatch[1];
    }
  }

  if (maxLines !== undefined) {
    const start = startLine ?? 1;
    return `Read ${fileName} ${start}-${start + maxLines - 1}`;
  }
  if (startLine !== undefined) {
    return `Read ${fileName} ${startLine}+`;
  }
  return `Read ${fileName}`;
}

type ToolSegment =
  | { kind: 'readGroup'; messages: Message[] }
  | { kind: 'single'; message: Message };

function segmentToolMessages(messages: Message[]): ToolSegment[] {
  const segments: ToolSegment[] = [];
  let i = 0;
  while (i < messages.length) {
    if (isFileReadMsg(messages[i])) {
      const start = i;
      while (i < messages.length && isFileReadMsg(messages[i])) i++;
      const group = messages.slice(start, i);
      if (group.length >= 2) {
        segments.push({ kind: 'readGroup', messages: group });
      } else {
        segments.push({ kind: 'single', message: group[0] });
      }
    } else {
      segments.push({ kind: 'single', message: messages[i] });
      i++;
    }
  }
  return segments;
}

const ChatReadListGroup = memo(function ChatReadListGroup({ messages }: { messages: Message[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <ToolActivityRow
      verb="read"
      main={`${messages.length} files`}
      status="ok"
      expandable
      expanded={isExpanded}
      onToggle={() => setIsExpanded((v) => !v)}
      detail={
        <ToolActivityChildren
          items={messages.map((msg) => ({
            id: msg.id,
            name: readDisplayName(msg).replace(/^Read\s+/, ''),
          }))}
        />
      }
    />
  );
});

export function ChatToolGroupContent({
  messages,
  onApprove,
  onDeny,
}: {
  messages: Message[];
  onApprove: (requestId: string) => void | Promise<void>;
  onDeny: (requestId: string) => void | Promise<void>;
}) {
  const segments = segmentToolMessages(messages);

  return (
    <>
      {segments.map((seg) => {
        if (seg.kind === 'readGroup') {
          return (
            <ChatReadListGroup key={`read-group-${seg.messages[0].id}`} messages={seg.messages} />
          );
        }
        const msg = seg.message;
        const content =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
        return msg.tool_name === CHAT_APPROVAL_TOOL_NAME ? (
          <ChatApprovalCard key={msg.id} message={msg} onApprove={onApprove} onDeny={onDeny} />
        ) : msg.tool_name === 'graph_index' ||
          msg.tool_name === 'graph_query' ||
          msg.tool_name === 'graph_trace' ? (
          <div key={msg.id} style={{ width: '100%' }}>
            <GraphToolResultCard message={msg} />
          </div>
        ) : (
          <div key={msg.id} style={{ width: '100%' }}>
            <ToolResultMessage
              dense
              message={{
                id: msg.id,
                role: 'tool',
                text: content,
                createdAt: msg.timestamp,
                tool_call_id: msg.tool_call_id,
                tool_name: msg.tool_name,
                tool_args: msg.tool_args,
                isError: msg.isError,
                isStreaming: msg.isStreaming,
                approvalStatus: msg.approvalStatus,
              }}
            />
          </div>
        );
      })}
    </>
  );
}
