/**
 * 统一通知工具函数
 * 提供 success, error, warning, info 四种通知类型
 */

import { isTauriCancellationError } from './errorHandling';

interface NotificationOptions {
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface NotificationItem extends NotificationOptions {
  id: string;
  createdAt: number;
}

type NotificationCallback = (notification: NotificationItem) => void;

let globalCallback: NotificationCallback | null = null;

/**
 * 注册全局通知回调
 */
export function registerNotification(callback: NotificationCallback): () => void {
  globalCallback = callback;
  return () => {
    globalCallback = null;
  };
}

/**
 * 全局显示通知函数
 * 可在非组件上下文中使用
 */
export function showError(message: string): void {
  const notification: NotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
    type: 'error',
    message,
    duration: 5000,
  };
  if (globalCallback) {
    globalCallback(notification);
  }
}

export function showSuccess(message: string): void {
  const notification: NotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
    type: 'success',
    message,
    duration: 3000,
  };
  if (globalCallback) {
    globalCallback(notification);
  }
}

/**
 * 创建通知 ID
 */
function createId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 显示通知
 */
function show(options: NotificationOptions): string {
  const notification: NotificationItem = {
    id: createId(),
    createdAt: Date.now(),
    ...options,
  };

  if (globalCallback) {
    globalCallback(notification);
  }

  return notification.id;
}

/**
 * 成功通知
 */
const notification = {
  error: (message: string, options?: Partial<Omit<NotificationOptions, 'type' | 'message'>>) => {
    return show({
      type: 'error',
      message,
      duration: 5000,
      ...options,
    });
  },
};

/**
 * 安全地显示错误通知
 * 自动过滤掉用户取消的操作
 */
export function notifyError(message: string, error?: unknown): void {
  if (error && isTauriCancellationError(error)) {
    return;
  }
  notification.error(message);
}
