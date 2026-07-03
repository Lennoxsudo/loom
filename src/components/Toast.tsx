/**
 * Toast 通知组件
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import styles from './Toast.module.css';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  onClose: (id: string) => void;
}

const iconMap = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

function Toast({ item }: { item: ToastItem }) {
  const t = useTranslation();
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (item.duration && item.duration > 0) {
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(() => item.onClose(item.id), 300);
      }, item.duration);
      return () => clearTimeout(timer);
    }
  }, [item]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => item.onClose(item.id), 300);
  };

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    item.action?.onClick();
  };

  return (
    <div className={`${styles.toast} ${styles[item.type]} ${isLeaving ? styles.leaving : ''}`}>
      <div className={styles.icon}>{iconMap[item.type]}</div>
      <div className={styles.content}>
        {item.title && <div className={styles.title}>{item.title}</div>}
        <div className={styles.message}>{item.message}</div>
        {item.action && (
          <button className={styles.action} onClick={handleActionClick}>
            {item.action.label}
          </button>
        )}
      </div>
      <button className={styles.close} onClick={handleClose} aria-label={t.ariaLabels.close}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export interface ToastContainerProps {
  toasts: ToastItem[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <Toast key={toast.id} item={{ ...toast, onClose }} />
      ))}
    </div>
  );
}
