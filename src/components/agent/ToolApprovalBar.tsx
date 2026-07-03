import { useTranslation } from '../../i18n';
import styles from './ToolApprovalBar.module.css';

export type ToolApprovalBarStatus = 'pending' | 'approved' | 'denied';

export interface ToolApprovalBarProps {
  status: ToolApprovalBarStatus;
  onApprove?: () => void;
  onReject?: () => void;
  layout?: 'footer' | 'header';
}

export function ToolApprovalOutcomeLabel({
  status,
}: {
  status: 'approved' | 'denied';
}) {
  const t = useTranslation();
  const label =
    status === 'approved'
      ? t.agent.approvalDialog.approve
      : t.agent.approvalDialog.reject;

  return (
    <span
      className={`${styles.outcomeLabel} ${
        status === 'approved' ? styles.outcomeApproved : styles.outcomeDenied
      }`}
    >
      {label}
    </span>
  );
}

export default function ToolApprovalBar({
  status,
  onApprove,
  onReject,
  layout = 'footer',
}: ToolApprovalBarProps) {
  const t = useTranslation();
  const layoutClass = layout === 'footer' ? styles.barFooter : styles.barHeader;

  if (status === 'approved') {
    return (
      <div className={`${styles.bar} ${layoutClass}`}>
        <span className={`${styles.badge} ${styles.badgeApproved}`}>
          {t.agent.approvalDialog.approve}
        </span>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={`${styles.bar} ${layoutClass}`}>
        <span className={`${styles.badge} ${styles.badgeDenied}`}>
          {t.agent.approvalDialog.reject}
        </span>
      </div>
    );
  }

  return (
    <div className={`${styles.bar} ${layoutClass}`}>
      {layout === 'footer' && (
        <span className={styles.pendingMeta}>
          <span className={styles.pendingDot} aria-hidden="true" />
          {t.agent.approvalDialog.title}
        </span>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.rejectButton} onClick={onReject}>
          {t.agent.approvalDialog.reject}
        </button>
        <button type="button" className={styles.approveButton} onClick={onApprove}>
          {t.agent.approvalDialog.approve}
        </button>
      </div>
    </div>
  );
}
