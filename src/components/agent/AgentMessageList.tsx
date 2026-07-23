import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';
import type { ChatMessage } from '../../types/chat';
import { scrollToMessage, type UserMessageLayoutCache } from './messageScrollUtils';
import AgentMessageRow, { type AgentGroupedItem } from './AgentMessageRow';
import { findPlanAnchorMessageId, insertAfterMessageAnchor } from '../../utils/planMessageAnchor';

export interface AgentMessageListHandle {
  scrollToMessageId: (messageId: string, behavior?: ScrollBehavior) => boolean;
}

interface AgentMessageListProps {
  messages: ChatMessage[];
  expandedThinkingIds: Set<string>;
  thinkingBlockAutoExpand: boolean;
  streamingContinuingLabel?: string;
  onToggleThinking: (messageId: string) => void;
  messagesContainerRef?: React.RefObject<HTMLDivElement | null>;
  onApproveTool?: (messageId: string) => void;
  onRejectTool?: (messageId: string) => void;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  getLayoutCache?: () => UserMessageLayoutCache;
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  userMessageEditDisabled?: boolean;
  /** Plan panel anchored after the plan tool turn */
  planSlot?: ReactNode;
}

const AgentMessageList = forwardRef<AgentMessageListHandle, AgentMessageListProps>(
  function AgentMessageList(
    {
      messages,
      expandedThinkingIds,
      thinkingBlockAutoExpand,
      streamingContinuingLabel = 'Generating response...',
      onToggleThinking,
      messagesContainerRef,
      onApproveTool,
      onRejectTool,
      onUserMessageLayout,
      getLayoutCache,
      onResendFromUserMessage,
      userMessageEditDisabled,
      planSlot,
    },
    ref
  ) {
    const grouped = useMemo<AgentGroupedItem[]>(() => {
      const fileReadTools = ['read', 'read_file', 'view_file', 'get_file_info', 'finfo'];
      const deleteTools = ['delete_file'];
      const isFileRead = (m: ChatMessage) =>
        m.role === 'tool' && fileReadTools.includes(m.tool_name || '');
      const isDelete = (m: ChatMessage) =>
        m.role === 'tool' &&
        deleteTools.includes(m.tool_name || '') &&
        m.approvalStatus !== 'pending';
      const result: AgentGroupedItem[] = [];
      let gi = 0;
      while (gi < messages.length) {
        if (isFileRead(messages[gi])) {
          const start = gi;
          while (gi < messages.length && isFileRead(messages[gi])) gi++;
          const grp = messages.slice(start, gi);
          if (grp.length >= 2) result.push({ kind: 'readGroup', messages: grp });
          else result.push({ kind: 'msg', message: grp[0] });
        } else if (isDelete(messages[gi])) {
          const start = gi;
          while (gi < messages.length && isDelete(messages[gi])) gi++;
          const grp = messages.slice(start, gi);
          if (grp.length >= 2) result.push({ kind: 'deleteGroup', messages: grp });
          else result.push({ kind: 'msg', message: grp[0] });
        } else {
          result.push({ kind: 'msg', message: messages[gi] });
          gi++;
        }
      }
      if (!planSlot) return result;
      const anchorId = findPlanAnchorMessageId(
        messages.map((m) => ({ id: m.id, role: m.role, tool_name: m.tool_name }))
      );
      return insertAfterMessageAnchor(
        result,
        { kind: 'plan', id: 'plan-document-panel' },
        anchorId
      );
    }, [messages, planSlot]);

    const groupedRef = useRef(grouped);
    groupedRef.current = grouped;

    useImperativeHandle(
      ref,
      () => ({
        scrollToMessageId(messageId: string, behavior: ScrollBehavior = 'smooth') {
          const container = messagesContainerRef?.current;
          if (!container) return false;

          return scrollToMessage(container, messageId, behavior, getLayoutCache?.());
        },
      }),
      [getLayoutCache, messagesContainerRef]
    );

    if (messages.length === 0) return null;

    return (
      <>
        {grouped.map((item, index) => (
          <AgentMessageRow
            key={
              item.kind === 'msg'
                ? item.message.id
                : item.kind === 'plan'
                  ? item.id
                  : (item.messages[0]?.id ?? `${item.kind}-${index}`)
            }
            item={item}
            expandedThinkingIds={expandedThinkingIds}
            thinkingBlockAutoExpand={thinkingBlockAutoExpand}
            streamingContinuingLabel={streamingContinuingLabel}
            onToggleThinking={onToggleThinking}
            onApproveTool={onApproveTool}
            onRejectTool={onRejectTool}
            onUserMessageLayout={onUserMessageLayout}
            onResendFromUserMessage={onResendFromUserMessage}
            userMessageEditDisabled={userMessageEditDisabled}
            planSlot={planSlot}
          />
        ))}
      </>
    );
  }
);

export default AgentMessageList;
