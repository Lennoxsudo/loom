/**
 * NotificationContext - 统一通知上下文
 * 提供通知状态管理和全局通知注册
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { ToastContainer, type ToastItem } from '../components/Toast';
import { registerNotification, type NotificationItem } from '../utils/notification';

interface NotificationContextType {
  showSuccess: (message: string, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

interface NotificationProviderProps {
  children: ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((notification: NotificationItem) => {
    const toast: ToastItem = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      duration: notification.duration,
      action: notification.action,
      onClose: (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
    };
    setToasts((prev) => [...prev, toast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 注册全局通知回调
  useEffect(() => {
    const unregister = registerNotification(addToast);
    return unregister;
  }, [addToast]);

  const showSuccess = useCallback((message: string, title?: string) => {
    const toast: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: 'success',
      title,
      message,
      duration: 3000,
      onClose: removeToast,
    };
    setToasts((prev) => [...prev, toast]);
  }, [removeToast]);

  const showError = useCallback((message: string, title?: string) => {
    const toast: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: 'error',
      title,
      message,
      duration: 5000,
      onClose: removeToast,
    };
    setToasts((prev) => [...prev, toast]);
  }, [removeToast]);

  const showWarning = useCallback((message: string, title?: string) => {
    const toast: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: 'warning',
      title,
      message,
      duration: 4000,
      onClose: removeToast,
    };
    setToasts((prev) => [...prev, toast]);
  }, [removeToast]);

  const showInfo = useCallback((message: string, title?: string) => {
    const toast: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: 'info',
      title,
      message,
      duration: 3000,
      onClose: removeToast,
    };
    setToasts((prev) => [...prev, toast]);
  }, [removeToast]);

  return (
    <NotificationContext.Provider
      value={{ showSuccess, showError, showWarning, showInfo }}
    >
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextType {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
}
