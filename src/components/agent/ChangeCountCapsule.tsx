import { memo, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { PendingFileChange } from './utils';
import { sumPendingChangeLineStats } from './pendingChangeStatsUtils';
import styles from './ChangeCountCapsule.module.css';

export interface ChangeCountCapsuleProps {
  pendingChanges: PendingFileChange[];
  onOpenReview: () => void;
}

const ChangeCountCapsule = memo(function ChangeCountCapsule({
  pendingChanges,
  onOpenReview,
}: ChangeCountCapsuleProps) {
  const t = useTranslation();

  const stats = useMemo(
    () => sumPendingChangeLineStats(pendingChanges),
    [pendingChanges]
  );

  if (pendingChanges.length === 0) {
    return null;
  }

  if (stats.added === 0 && stats.removed === 0) {
    return null;
  }

  const ariaLabel = t.agent.changeReview.changeCountAria
    .replace('{added}', String(stats.added))
    .replace('{removed}', String(stats.removed));

  return (
    <button
      type="button"
      className={styles.capsule}
      data-testid="change-count-capsule"
      title={t.agent.changeReview.openReview}
      aria-label={ariaLabel}
      onClick={onOpenReview}
    >
      <span className={styles.label}>{t.agent.changeReview.changeCountLabel}</span>
      <span className={styles.stats}>
        <span className={`${styles.stat} ${styles.added}`}>
          <span className={styles.sign}>+</span>
          <span className={styles.count}>{stats.added}</span>
        </span>
        <span className={`${styles.stat} ${styles.removed}`}>
          <span className={styles.sign}>-</span>
          <span className={styles.count}>{stats.removed}</span>
        </span>
      </span>
    </button>
  );
});

export default ChangeCountCapsule;
