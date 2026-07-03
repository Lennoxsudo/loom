import { memo } from 'react';
import MessageBubble from './ChatMessageBubble';
import { ChatToolGroupContent } from './chatListToolContent';
import PendingChangesBar from './PendingChangesBar';
import type { Message, PendingFileChange } from './types';
import type { GroupedChatItem } from './userMsgMarkerPositions';
import type { I18nMessages } from '../../i18n/types';

export interface ChatListRowProps {
  index: number;
  item: GroupedChatItem;
  isLast: boolean;
  onApprovePendingToolCalls: (requestId: string) => void | Promise<void>;
  onDenyPendingToolCalls: (requestId: string) => void | Promise<void>;
  pendingChangesCollapsed: boolean;
  setPendingChangesCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenPendingChangeFile: (filePath: string) => void;
  onAcceptPendingChange: (change: PendingFileChange) => void;
  onRollbackPendingChange: (change: PendingFileChange) => Promise<void>;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  t: I18nMessages;
}

function ChatListRow({
  index,
  item,
  isLast,
  onApprovePendingToolCalls,
  onDenyPendingToolCalls,
  pendingChangesCollapsed,
  setPendingChangesCollapsed,
  onOpenPendingChangeFile,
  onAcceptPendingChange,
  onRollbackPendingChange,
  onUserMessageLayout,
  t,
}: ChatListRowProps) {
  const isToolGroup = 'type' in item && item.type === 'tool_group';
  const isPendingChanges = 'type' in item && item.type === 'pending_changes';

  return (
    <div
      style={{
        paddingBottom: isToolGroup ? 0 : isLast ? 20 : 5,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: index === 0 ? 20 : 0,
      }}
    >
      {isPendingChanges ? (
        <PendingChangesBar
          pendingChanges={item.changes}
          collapsed={pendingChangesCollapsed}
          setCollapsed={setPendingChangesCollapsed}
          t={t}
          variant="inline"
          onOpenFile={onOpenPendingChangeFile}
          onAccept={onAcceptPendingChange}
          onRollback={onRollbackPendingChange}
        />
      ) : isToolGroup ? (
        <ChatToolGroupContent
          messages={item.messages}
          onApprove={onApprovePendingToolCalls}
          onDeny={onDenyPendingToolCalls}
        />
      ) : (
        <MessageBubble
          message={item as Message}
          onUserMessageLayout={onUserMessageLayout}
        />
      )}
    </div>
  );
}

export default memo(ChatListRow);
