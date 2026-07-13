import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { AgentCheckpoint } from '../../utils/checkpointTimeline';
import { shortFileName } from '../../utils/checkpointTimeline';
import styles from './ChangeReviewPanel.module.css';

export interface CheckpointTimelineProps {
  checkpoints: AgentCheckpoint[];
  restoringId: string | null;
  selectedId: string | null;
  onSelect: (checkpoint: AgentCheckpoint) => void;
  onRestore: (checkpoint: AgentCheckpoint) => Promise<void>;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

const CheckpointTimeline = memo(function CheckpointTimeline({
  checkpoints,
  restoringId,
  selectedId,
  onSelect,
  onRestore,
}: CheckpointTimelineProps) {
  const t = useTranslation();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...checkpoints].sort((a, b) => b.createdAt - a.createdAt),
    [checkpoints]
  );

  const handleRestoreClick = useCallback(
    async (cp: AgentCheckpoint) => {
      if (confirmId !== cp.id) {
        setConfirmId(cp.id);
        return;
      }
      setConfirmId(null);
      await onRestore(cp);
    },
    [confirmId, onRestore]
  );

  if (ordered.length === 0) {
    return <div className={styles.empty}>{t.agent.changeReview.noCheckpoints}</div>;
  }

  return (
    <div className={styles.timelineBody} data-testid="checkpoint-timeline">
      <div className={styles.timelineHint}>{t.agent.changeReview.checkpointHint}</div>
      <ol className={styles.timelineList}>
        {ordered.map((cp, index) => {
          const isSelected = selectedId === cp.id;
          const isRestoring = restoringId === cp.id;
          const isConfirm = confirmId === cp.id;
          const fileNames = cp.files
            .slice(0, 3)
            .map((f) => shortFileName(f.path))
            .join(', ');
          const more = cp.files.length > 3 ? ` +${cp.files.length - 3}` : '';

          return (
            <li
              key={cp.id}
              className={`${styles.timelineItem} ${isSelected ? styles.rowSelected : ''}`}
              data-testid="checkpoint-row"
            >
              <div className={styles.timelineRail} aria-hidden>
                <span className={styles.timelineDot} />
                {index < ordered.length - 1 ? <span className={styles.timelineLine} /> : null}
              </div>
              <div className={styles.timelineContent}>
                <button
                  type="button"
                  className={styles.timelineLabelButton}
                  onClick={() => onSelect(cp)}
                  title={cp.label}
                >
                  <span className={styles.timelineLabel}>{cp.label}</span>
                  <span className={styles.timelineMeta}>
                    {formatTime(cp.createdAt)}
                    {fileNames ? ` · ${fileNames}${more}` : ''}
                  </span>
                </button>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={`${styles.actionButton} ${isConfirm ? styles.restoreConfirm : styles.restoreButton}`}
                    disabled={isRestoring || restoringId != null}
                    onClick={() => void handleRestoreClick(cp)}
                    data-testid="checkpoint-restore"
                    title={t.agent.changeReview.restoreCheckpoint}
                  >
                    {isRestoring
                      ? t.agent.changeReview.restoring
                      : isConfirm
                        ? t.agent.changeReview.confirmRestore
                        : t.agent.changeReview.restoreCheckpoint}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
});

export default CheckpointTimeline;
