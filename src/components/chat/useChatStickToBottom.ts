import { useCallback, useEffect, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

const DEFAULT_THRESHOLD = 80;

export interface UseChatStickToBottomOptions {
  virtuosoRef: React.MutableRefObject<VirtuosoHandle | null>;
  /** The actual DOM scroller element (from Virtuoso's scrollerRef callback). */
  scrollerRef?: React.MutableRefObject<HTMLDivElement | null>;
  threshold?: number;
}

export interface UseChatStickToBottomResult {
  /** Virtuoso followOutput — 'auto' when stuck, false when user scrolled away. */
  followOutput: false | 'auto';
  /** px threshold for atBottom detection. */
  atBottomThreshold: number;
  /** Virtuoso atBottomStateChange. */
  onAtBottomStateChange: (atBottom: boolean) => void;
  /** Virtuoso totalListHeightChanged. */
  onTotalListHeightChanged: () => void;
  /** Virtuoso isScrolling. */
  onIsScrolling: (scrolling: boolean) => void;
  /** Whether the "scroll to bottom" button is visible. */
  showScrollButton: boolean;
  /** Ref tracking whether user is actively scrolling. */
  isUserScrollingRef: React.MutableRefObject<boolean>;
  /** Smooth-scroll to bottom and re-stick (button click). */
  scrollToBottom: () => void;
  /** Instantly stick to bottom (new message sent). */
  stickToBottom: () => void;
}

/**
 * 统一管理 Chat 列表的底部吸附自动滚动行为。
 *
 * 核心原则：**只信任 Virtuoso 的 followOutput 机制**，完全不操作 DOM 滚动。
 * 流式输出时由 followOutput 自动跟随，用户手动滚动时 followOutput 自动断开。
 * 唯一例外：点击"滚动到底部"按钮时直接操作 DOM 做平滑滚动。
 */
export function useChatStickToBottom({
  virtuosoRef,
  scrollerRef,
  threshold = DEFAULT_THRESHOLD,
}: UseChatStickToBottomOptions): UseChatStickToBottomResult {
  const [followOutput, setFollowOutput] = useState<false | 'auto'>('auto');
  const [showScrollButton, setShowScrollButton] = useState(false);

  // pendingStick 必须是 state 才能触发 useEffect 重跑
  const [pendingStick, setPendingStick] = useState(false);

  // 内部状态
  const isAtBottomRef = useRef(true);
  const isUserScrollingRef = useRef(false);
  const isStickingRef = useRef(false);

  // RAF 句柄
  const stickRafRef = useRef<number | null>(null);

  /**
   * 立即吸附到底部 - 用于发送新消息时
   *
   * 策略：只设置 followOutput: 'auto'，让 Virtuoso 处理滚动。
   * scroller 未就绪时通过 pendingStick state + useEffect 等待。
   */
  const stickToBottom = useCallback(() => {
    isStickingRef.current = true;
    isAtBottomRef.current = true;
    setFollowOutput('auto');
    setShowScrollButton(false);

    const el = scrollerRef?.current;

    if (el) {
      // scroller 已就绪：让 Virtuoso 处理滚动（通过 followOutput: 'auto'）
      // 同时直接设置 scrollTop 确保最快响应
      requestAnimationFrame(() => {
        const scroller = scrollerRef?.current;
        if (!scroller || !isStickingRef.current) return;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        if (maxScroll > 0) {
          scroller.scrollTop = maxScroll;
        }
      });
    } else {
      // scroller 未就绪：等待 scrollerRef 变化时触发
      setPendingStick(true);
    }
  }, []); // 空依赖，因为 scrollerRef 是 ref

  /**
   * 监听 scrollerRef 变化 + pendingStick 变化：
   * 当 scroller 就绪且有待执行的吸附时，执行滚动
   */
  useEffect(() => {
    if (pendingStick && scrollerRef?.current) {
      setPendingStick(false);
      requestAnimationFrame(() => {
        const scroller = scrollerRef?.current;
        if (!scroller || !isStickingRef.current) return;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        if (maxScroll > 0) {
          scroller.scrollTop = maxScroll;
        }
      });
    }
  }, [pendingStick, scrollerRef?.current]);

  /**
   * 平滑滚动到底部 - 用于点击"滚动到底部"按钮
   *
   * 直接操作 DOM 做平滑滚动，完成后同步 Virtuoso 状态。
   */
  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    isStickingRef.current = true;
    setFollowOutput('auto');
    setShowScrollButton(false);

    const el = scrollerRef?.current;
    if (!el) return;

    // easeOutCubic 平滑滚动
    const startScrollTop = el.scrollTop;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const distance = maxScroll - startScrollTop;
    const duration = Math.min(300, Math.abs(distance) * 0.5);
    const startTime = performance.now();

    const tick = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      el.scrollTop = startScrollTop + distance * eased;

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        // 滚动完成后同步 Virtuoso 内部状态
        virtuosoRef.current?.scrollToIndex({
          index: 'LAST',
          align: 'end',
          behavior: 'auto',
        });
      }
    };

    requestAnimationFrame(tick);
  }, []); // 空依赖

  /**
   * Virtuoso 的 atBottomStateChange 回调
   *
   * 核心：用户离开底部时停止 followOutput。流式输出时完全由 Virtuoso 控制滚动。
   */
  const onAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setFollowOutput(atBottom ? 'auto' : false);
    setShowScrollButton(!atBottom);

    if (!atBottom) {
      isStickingRef.current = false;
      setPendingStick(false);
    }
  }, []);

  /**
   * Virtuoso 的 totalListHeightChanged 回调
   *
   * 当列表内容高度变化时触发。
   * 由于 followOutput: 'auto' 已自动处理跟随，不需要额外操作。
   */
  const onTotalListHeightChanged = useCallback(() => {
    // followOutput: 'auto' 会自动处理，无需手动 DOM 操作
  }, []);

  /**
   * Virtuoso 的 isScrolling 回调
   *
   * 只跟踪用户滚动状态，不操作 DOM，避免与 followOutput 冲突。
   */
  const onIsScrolling = useCallback((scrolling: boolean) => {
    isUserScrollingRef.current = scrolling;
  }, []);

  // 清理副作用
  useEffect(() => {
    return () => {
      if (stickRafRef.current !== null) {
        cancelAnimationFrame(stickRafRef.current);
      }
    };
  }, []);

  return {
    followOutput,
    atBottomThreshold: threshold,
    onAtBottomStateChange,
    onTotalListHeightChanged,
    onIsScrolling,
    showScrollButton,
    isUserScrollingRef,
    scrollToBottom,
    stickToBottom,
  };
}
