import type { ReactNode } from 'react';
import styles from './ToolApprovalShell.module.css';

export type ToolApprovalShellMode = 'pending' | 'denied' | 'resolved';

export interface ToolApprovalShellProps {
  mode: ToolApprovalShellMode;
  children: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
}

export default function ToolApprovalShell({
  mode,
  children,
  footer,
  compact = false,
}: ToolApprovalShellProps) {
  return (
    <div
      className={`${styles.shell} ${
        mode === 'pending'
          ? styles.shellPending
          : mode === 'denied'
            ? styles.shellDenied
            : styles.shellResolved
      }`}
    >
      <div className={compact ? styles.bodyCompact : styles.body}>{children}</div>
      {footer}
    </div>
  );
}
