import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useObservedHeight } from '../../hooks/useObservedHeight';
import ChatListRow from './ChatListRow';
import ChatPinnedScroller from './ChatPinnedScroller';
import styles from './ChatVirtuosoList.module.css';
import type { Message, PendingFileChange } from './types';
import type { GroupedChatItem } from './userMsgMarkerPositions';
import type { I18nMessages } from '../../i18n/types';

export interface ChatVirtuosoListProps {
  grouped: GroupedChatItem[];
  virtuosoRef: React.MutableRefObject<VirtuosoHandle | null>;
  scrollBottomThreshold: number;
  onScrollerRef: (el: HTMLElement | Window | null) => void;
  onAtBottomStateChange: (atBottom: boolean) => void;
  onTotalListHeightChanged: () => void;
  onIsScrolling: (scrolling: boolean) => void;
  followOutput: false | 'auto';
  onApprovePendingToolCalls: (requestId: string) => void | Promise<void>;
  onDenyPendingToolCalls: (requestId: string) => void | Promise<void>;
  pendingChangesCollapsed: boolean;
  setPendingChangesCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenPendingChangeFile: (filePath: string) => void;
  onAcceptPendingChange: (change: PendingFileChange) => void;
  onRollbackPendingChange: (change: PendingFileChange) => Promise<void>;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  userMessageEditDisabled?: boolean;
  t: I18nMessages;
  bottomInset?: number;
  /** Plan panel slot rendered for `plan_document` list items */
  planSlot?: ReactNode;
}


function ChatVirtuosoList({
  grouped,
  virtuosoRef,
  scrollBottomThreshold,
  onScrollerRef,
  onAtBottomStateChange,
  onTotalListHeightChanged,
  onIsScrolling,
  followOutput,
  onApprovePendingToolCalls,
  onDenyPendingToolCalls,
  pendingChangesCollapsed,
  setPendingChangesCollapsed,
  onOpenPendingChangeFile,
  onAcceptPendingChange,
  onRollbackPendingChange,
  onUserMessageLayout,
  onResendFromUserMessage,
  userMessageEditDisabled = false,
  t,
  bottomInset = 0,
  planSlot,
}: ChatVirtuosoListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerHeight = useObservedHeight(containerRef);

  const itemContent = useCallback(
    (index: number, item: GroupedChatItem) => (
      <ChatListRow
        index={index}
        item={item}
        isLast={index === grouped.length - 1}
        onApprovePendingToolCalls={onApprovePendingToolCalls}
        onDenyPendingToolCalls={onDenyPendingToolCalls}
        pendingChangesCollapsed={pendingChangesCollapsed}
        setPendingChangesCollapsed={setPendingChangesCollapsed}
        onOpenPendingChangeFile={onOpenPendingChangeFile}
        onAcceptPendingChange={onAcceptPendingChange}
        onRollbackPendingChange={onRollbackPendingChange}
        onUserMessageLayout={onUserMessageLayout}
        onResendFromUserMessage={onResendFromUserMessage}
        userMessageEditDisabled={userMessageEditDisabled}
        planSlot={planSlot}
        t={t}
      />
    ),
    [
      grouped.length,
      onApprovePendingToolCalls,
      onDenyPendingToolCalls,
      pendingChangesCollapsed,
      setPendingChangesCollapsed,
      onOpenPendingChangeFile,
      onAcceptPendingChange,
      onRollbackPendingChange,
      onUserMessageLayout,
      onResendFromUserMessage,
      userMessageEditDisabled,
      planSlot,
      t,
    ]
  );

  const computeItemKey = useCallback((_index: number, item: GroupedChatItem) => {
    if ('type' in item) {
      return item.id;
    }
    return (item as Message).id;
  }, []);

  const ListFooter = useCallback(
    () => <div aria-hidden style={{ height: Math.max(0, bottomInset), flexShrink: 0 }} />,
    [bottomInset],
  );

  const virtuosoComponentsWithFooter = useMemo(
    () => ({
      Scroller: ChatPinnedScroller,
      Footer: ListFooter,
    }),
    [ListFooter]
  );

  return (
    <div ref={containerRef} className={styles.container}>
      {containerHeight > 0 && (
        <Virtuoso
          ref={virtuosoRef}
          scrollerRef={onScrollerRef}
          style={{ height: '100%' }}
          data={grouped}
          components={virtuosoComponentsWithFooter}
          atBottomThreshold={scrollBottomThreshold}
          atBottomStateChange={onAtBottomStateChange}
          totalListHeightChanged={onTotalListHeightChanged}
          followOutput={followOutput}
          isScrolling={onIsScrolling}
          skipAnimationFrameInResizeObserver
          increaseViewportBy={600}
          initialTopMostItemIndex={{ index: 'LAST' }}
          computeItemKey={computeItemKey}
          itemContent={itemContent}
        />
      )}
    </div>
  );
}

export default memo(ChatVirtuosoList);
