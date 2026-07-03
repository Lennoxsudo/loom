import { useCallback, useRef } from 'react';
import type { ChatApprovalSummary } from '../chat/types';

const AUTO_APPROVE_TIMEOUT_MS = 40_000; // 40s 无操作自动放行

type PendingApprovalItem = {
  messageId: string;
  summary: ChatApprovalSummary;
  resolve: (approved: boolean) => void;
};

export function useAgentApproval() {
  const queueRef = useRef<PendingApprovalItem[]>([]);
  const activeRef = useRef<PendingApprovalItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settleActive = useCallback((approved: boolean) => {
    // 清除自动放行定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const active = activeRef.current;
    if (!active) return;
    active.resolve(approved);

    // 处理队列中的下一个
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;

    // 下一个项目启动自动放行定时器
    if (next) {
      timerRef.current = setTimeout(() => {
        settleActive(true);
      }, AUTO_APPROVE_TIMEOUT_MS);
    }
  }, []);

  const requestApproval = useCallback(
    ({
      messageId,
      summary,
    }: {
      messageId: string;
      summary: ChatApprovalSummary;
    }): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const item: PendingApprovalItem = { messageId, summary, resolve };
        if (!activeRef.current) {
          activeRef.current = item;
          // 第一个审批项启动自动放行定时器
          timerRef.current = setTimeout(() => {
            settleActive(true);
          }, AUTO_APPROVE_TIMEOUT_MS);
        } else {
          queueRef.current.push(item);
        }
      });
    },
    [settleActive]
  );

  const approve = useCallback(
    (messageId: string) => {
      if (activeRef.current?.messageId !== messageId) return;
      settleActive(true);
    },
    [settleActive]
  );

  const reject = useCallback(
    (messageId: string) => {
      if (activeRef.current?.messageId !== messageId) return;
      settleActive(false);
    },
    [settleActive]
  );

  return {
    requestApproval,
    approve,
    reject,
  };
}
