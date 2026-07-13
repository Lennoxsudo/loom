import { useState, useRef, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from './types';
import {
  areUserMsgMarkersEqual,
  computeUserMsgMarkerPositions,
  type GroupedChatItem,
  type UserMsgMarker,
} from './userMsgMarkerPositions';
import ChatVirtuosoList from './ChatVirtuosoList';
import ChatScrollMarkers from './ChatScrollMarkers';
import ChatScrollToBottomButton from './ChatScrollToBottomButton';
import { useUserMessageLayoutRegistry } from '../agent/hooks/useUserMessageLayoutRegistry';
import { useChatPinnedUserMessage } from './useChatPinnedUserMessage';
import { getChatUserMessagePreviewText } from './chatPinnedUserMessage';
import type { PendingFileChange } from './types';
import type { I18nMessages } from '../../i18n/types';
import {
  findPlanAnchorMessageId,
  insertAfterMessageAnchor,
} from '../../utils/planMessageAnchor';
import styles from './ChatMessageList.module.css';
import userBubbleStyles from './ChatUserBubble.module.css';

export interface ChatMessageListProps {
  messages: Message[];
  pendingChanges: PendingFileChange[];
  showPendingChangesBar: boolean;
  pendingChangesCollapsed: boolean;
  setPendingChangesCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenPendingChangeFile: (filePath: string) => void;
  onAcceptPendingChange: (change: PendingFileChange) => void;
  onRollbackPendingChange: (change: PendingFileChange) => Promise<void>;
  t: I18nMessages;
  onApprovePendingToolCalls: (requestId: string) => void | Promise<void>;
  onDenyPendingToolCalls: (requestId: string) => void | Promise<void>;
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  userMessageEditDisabled?: boolean;
  virtuosoRef: React.MutableRefObject<VirtuosoHandle | null>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollerRef: React.MutableRefObject<HTMLDivElement | null>;

  /** Stick-to-bottom callbacks (from useChatStickToBottom). */
  followOutput: false | 'auto';
  atBottomThreshold: number;
  onAtBottomStateChange: (atBottom: boolean) => void;
  onTotalListHeightChanged: () => void;
  onIsScrolling: (scrolling: boolean) => void;
  showScrollButton: boolean;
  isUserScrollingRef: React.MutableRefObject<boolean>;
  onScrollToBottom: () => void;

  emptyStateText: string;
  watchKey?: string | null;
  bottomOverlayInset?: number;
  bottomDockRevision?: number;
  /**
   * Plan panel inserted after the plan-tool turn (not forever at the list end).
   * Subsequent user/assistant messages render below the plan.
   */
  planSlot?: ReactNode;
}

const MARKER_HEIGHT_DEBOUNCE_MS = 300;

export default function ChatMessageList({
  messages,
  pendingChanges,
  showPendingChangesBar,
  pendingChangesCollapsed,
  setPendingChangesCollapsed,
  onOpenPendingChangeFile,
  onAcceptPendingChange,
  onRollbackPendingChange,
  t,
  onApprovePendingToolCalls,
  onDenyPendingToolCalls,
  onResendFromUserMessage,
  userMessageEditDisabled = false,
  virtuosoRef,
  messagesContainerRef,
  scrollerRef,
  followOutput,
  atBottomThreshold,
  onAtBottomStateChange,
  onTotalListHeightChanged,
  onIsScrolling,
  showScrollButton,
  isUserScrollingRef,
  onScrollToBottom,
  emptyStateText,
  watchKey = null,
  bottomOverlayInset = 0,
  bottomDockRevision = 0,
  planSlot,
}: ChatMessageListProps) {
  const [userMsgMarkers, setUserMsgMarkers] = useState<UserMsgMarker[]>([]);

  const markerUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMsgMarkersRef = useRef<UserMsgMarker[]>([]);
  const localScrollerRef = useRef<HTMLDivElement | null>(null);

  const { registerUserMessage, getLayoutCache, clearLayoutCache } =
    useUserMessageLayoutRegistry(localScrollerRef);
  const { pinnedMessage, showStickyOverlay, scheduleUpdate } = useChatPinnedUserMessage({
    messages,
    scrollContainerRef: localScrollerRef,
    getLayoutCache,
    watchKey,
  });

  const handleUserMessageLayout = useCallback(
    (messageId: string, element: HTMLElement | null) => {
      registerUserMessage(messageId, element);
      scheduleUpdate();
    },
    [registerUserMessage, scheduleUpdate]
  );

  useEffect(() => {
    clearLayoutCache();
  }, [watchKey, clearLayoutCache]);

  userMsgMarkersRef.current = userMsgMarkers;

  const grouped = useMemo(() => {
    const result: GroupedChatItem[] = [];
    let currentToolGroup: Message[] = [];

    messages.forEach((msg) => {
      if (msg.role === 'tool') {
        currentToolGroup.push(msg);
      } else {
        if (currentToolGroup.length > 0) {
          result.push({
            type: 'tool_group',
            id: `group-${currentToolGroup[0].id}`,
            messages: [...currentToolGroup],
          });
          currentToolGroup = [];
        }
        result.push(msg);
      }
    });

    if (currentToolGroup.length > 0) {
      result.push({
        type: 'tool_group',
        id: `group-${currentToolGroup[0].id}`,
        messages: [...currentToolGroup],
      });
    }

    if (showPendingChangesBar && pendingChanges.length > 0) {
      result.push({
        type: 'pending_changes',
        id: 'pending-changes-footer',
        changes: pendingChanges,
      });
    }

    // Anchor plan after the plan-tool turn so later messages stay below it
    // (not stuck forever at the absolute bottom of the conversation).
    if (!planSlot) return result;
    const anchorId = findPlanAnchorMessageId(
      messages.map((m) => ({ id: m.id, role: m.role, tool_name: m.tool_name })),
    );
    const planItem: GroupedChatItem = {
      type: 'plan_document',
      id: 'plan-document-panel',
    };
    return insertAfterMessageAnchor(result, planItem, anchorId);
  }, [messages, pendingChanges, showPendingChangesBar, planSlot]);

  const updateUserMsgMarkers = useCallback(() => {
    if (isUserScrollingRef.current) return;

    const scroller = scrollerRef.current;
    const handle = virtuosoRef.current;
    if (!scroller || !handle) {
      if (userMsgMarkersRef.current.length > 0) {
        setUserMsgMarkers([]);
      }
      return;
    }

    const scrollHeight = scroller.scrollHeight;
    if (scrollHeight <= 0) {
      if (userMsgMarkersRef.current.length > 0) {
        setUserMsgMarkers([]);
      }
      return;
    }

    handle.getState((state) => {
      const next = computeUserMsgMarkerPositions(grouped, state.ranges, scrollHeight);
      if (areUserMsgMarkersEqual(userMsgMarkersRef.current, next)) return;
      setUserMsgMarkers(next);
    });
  }, [grouped, isUserScrollingRef, virtuosoRef]);

  const scheduleMarkerUpdate = useCallback(
    (delayMs = 0) => {
      if (markerUpdateTimerRef.current) {
        clearTimeout(markerUpdateTimerRef.current);
        markerUpdateTimerRef.current = null;
      }

      if (delayMs <= 0) {
        requestAnimationFrame(() => updateUserMsgMarkers());
        return;
      }

      markerUpdateTimerRef.current = setTimeout(() => {
        markerUpdateTimerRef.current = null;
        updateUserMsgMarkers();
      }, delayMs);
    },
    [updateUserMsgMarkers]
  );

  useEffect(() => {
    scheduleMarkerUpdate();
    return () => {
      if (markerUpdateTimerRef.current) {
        clearTimeout(markerUpdateTimerRef.current);
        markerUpdateTimerRef.current = null;
      }
    };
  }, [messages, scheduleMarkerUpdate]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    let markerTimer: ReturnType<typeof setTimeout> | undefined;

    // ResizeObserver on the scroller is only needed for updating user-msg
    // markers (scroll-position-based). Virtuoso already handles re-scrolling
    // via followOutput + totalListHeightChanged, so we do NOT call
    // onTotalListHeightChanged here — that was causing duplicate scroll
    // commands that competed with followOutput.
    const observer = new ResizeObserver(() => {
      clearTimeout(markerTimer);
      markerTimer = setTimeout(updateUserMsgMarkers, 200);
    });
    observer.observe(el);
    updateUserMsgMarkers();

    return () => {
      clearTimeout(markerTimer);
      observer.disconnect();
    };
  }, [messages.length, updateUserMsgMarkers]);

  // Re-scroll when bottom dock layout changes (TodoListBar expand/collapse,
  // textarea grow/shrink). Virtuoso's totalListHeightChanged may not fire
  // for container-only resizes, so we trigger explicitly.
  useEffect(() => {
    onTotalListHeightChanged();
  }, [bottomOverlayInset, bottomDockRevision, onTotalListHeightChanged]);

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const idx = grouped.findIndex(
        (item) => !('type' in item) && (item as Message).id === messageId
      );
      if (idx >= 0 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({ index: idx, behavior: 'smooth', align: 'center' });
      }
    },
    [grouped, virtuosoRef]
  );

  const handleJumpToPinnedUserMessage = useCallback(() => {
    if (!pinnedMessage) return;
    scrollToMessage(pinnedMessage.id);
  }, [pinnedMessage, scrollToMessage]);

  const pinnedPreviewText = useMemo(() => {
    if (!pinnedMessage) return '';
    return getChatUserMessagePreviewText(
      pinnedMessage,
      t.agent.userMessageAttachmentOnly,
      t.chat.fileContext
    );
  }, [pinnedMessage, t.agent.userMessageAttachmentOnly, t.chat.fileContext]);

  const showPinnedOverlay = showStickyOverlay && pinnedPreviewText.length > 0;

  const handleScrollerRef = useCallback(
    (el: HTMLElement | Window | null) => {
      const div = el as HTMLDivElement | null;
      localScrollerRef.current = div;
      scrollerRef.current = div;
      if (el && el instanceof HTMLElement) {
        requestAnimationFrame(() => {
          updateUserMsgMarkers();
          scheduleUpdate();
        });
      }
    },
    [updateUserMsgMarkers, scheduleUpdate, scrollerRef]
  );

  const handleTotalListHeightChanged = useCallback(() => {
    onTotalListHeightChanged();
    scheduleMarkerUpdate(MARKER_HEIGHT_DEBOUNCE_MS);
  }, [onTotalListHeightChanged, scheduleMarkerUpdate]);

  const handleIsScrolling = useCallback(
    (scrolling: boolean) => {
      onIsScrolling(scrolling);
      if (!scrolling) {
        scheduleMarkerUpdate(200);
      }
    },
    [onIsScrolling, scheduleMarkerUpdate]
  );

  if (messages.length === 0) {
    return (
      <div ref={messagesContainerRef} className={styles.emptyWrap}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>{emptyStateText}</div>
        </div>
        {planSlot ? (
          <div className={styles.emptyPlanAnchor} data-testid="chat-plan-scroll-anchor">
            {planSlot}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.listWrap}>
      <ChatVirtuosoList
        grouped={grouped}
        virtuosoRef={virtuosoRef}
        scrollBottomThreshold={atBottomThreshold}
        onScrollerRef={handleScrollerRef}
        onAtBottomStateChange={onAtBottomStateChange}
        onTotalListHeightChanged={handleTotalListHeightChanged}
        onIsScrolling={handleIsScrolling}
        followOutput={followOutput}
        onApprovePendingToolCalls={onApprovePendingToolCalls}
        onDenyPendingToolCalls={onDenyPendingToolCalls}
        pendingChangesCollapsed={pendingChangesCollapsed}
        setPendingChangesCollapsed={setPendingChangesCollapsed}
        onOpenPendingChangeFile={onOpenPendingChangeFile}
        onAcceptPendingChange={onAcceptPendingChange}
        onRollbackPendingChange={onRollbackPendingChange}
        onUserMessageLayout={handleUserMessageLayout}
        planSlot={planSlot}
        onResendFromUserMessage={onResendFromUserMessage}
        userMessageEditDisabled={userMessageEditDisabled}
        t={t}
        bottomInset={bottomOverlayInset}
      />

      {showPinnedOverlay && (
        <div className={styles.pinnedUserOverlay}>
          <button
            type="button"
            className={userBubbleStyles.pinnedBubbleButton}
            onClick={handleJumpToPinnedUserMessage}
            aria-label={t.agent.scrollToUserMessage}
            title={t.agent.scrollToUserMessage}
          >
            <span className={userBubbleStyles.bubbleTextClamped}>{pinnedPreviewText}</span>
          </button>
        </div>
      )}

      <ChatScrollMarkers markers={userMsgMarkers} onJumpToMessage={scrollToMessage} />

      {showScrollButton && (
        <ChatScrollToBottomButton
          onClick={onScrollToBottom}
          bottomOffset={16 + bottomOverlayInset}
        />
      )}
    </div>
  );
}
