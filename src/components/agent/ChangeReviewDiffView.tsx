import { memo } from 'react';
import { useTranslation } from '../../i18n';
import PendingChangeStats from './PendingChangeStats';
import { getShortFileName, type PendingFileChange } from './utils';
import styles from './ChangeReviewPanel.module.css';

export interface ChangeReviewDiffViewProps {
  pendingChanges: PendingFileChange[];
  selectedChangeId: string | null;
  onSelectPreview: (change: PendingFileChange) => void;
  onAccept: (change: PendingFileChange) => void;
  onDiscard: (change: PendingFileChange) => Promise<void>;
  onAcceptAll: (changes: PendingFileChange[]) => void;
  onDiscardAll: (changes: PendingFileChange[]) => Promise<void>;
  onViewImpact?: (change: PendingFileChange) => void;
  impactLoadingId?: string | null;
  impactActiveId?: string | null;
  cbmReady?: boolean;
}

const ChangeReviewDiffView = memo(function ChangeReviewDiffView({
  pendingChanges,
  selectedChangeId,
  onSelectPreview,
  onAccept,
  onDiscard,
  onAcceptAll,
  onDiscardAll,
  onViewImpact,
  impactLoadingId = null,
  impactActiveId = null,
  cbmReady = false,
}: ChangeReviewDiffViewProps) {
  const t = useTranslation();
  const cr = t.agent.changeReview;

  return (
    <>
      {pendingChanges.length > 0 && (
        <div className={styles.bulkActions}>
          <button
            type="button"
            className={`${styles.bulkButton} ${styles.acceptAll}`}
            onClick={() => onAcceptAll(pendingChanges)}
          >
            {t.agent.changeReview.acceptAll}
          </button>
          <button
            type="button"
            className={`${styles.bulkButton} ${styles.discardAll}`}
            onClick={() => void onDiscardAll(pendingChanges)}
          >
            {t.agent.changeReview.discardAll}
          </button>
        </div>
      )}

      <div className={styles.body}>
        {pendingChanges.length === 0 ? (
          <div className={styles.empty}>{t.agent.changeReview.noChanges}</div>
        ) : (
          pendingChanges.map((change) => {
            const isSelected = selectedChangeId === change.id;

            return (
              <div
                key={change.id}
                className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                data-testid="review-file-row"
              >
                <div className={styles.rowHeader}>
                  <button
                    type="button"
                    className={styles.fileNameButton}
                    title={change.filePath}
                    onClick={() => onSelectPreview(change)}
                    data-testid="review-file-name"
                  >
                    {getShortFileName(change.filePath)}
                  </button>
                  <PendingChangeStats
                    beforeContent={change.beforeContent}
                    afterContent={change.afterContent}
                    toolName={change.toolName}
                    oldSnippet={change.oldSnippet}
                    newSnippet={change.newSnippet}
                  />
                  <div className={styles.rowActions}>
                    {onViewImpact ? (
                      <button
                        type="button"
                        className={`${styles.actionButton} ${
                          impactActiveId === change.id ? styles.actionButtonActive : ''
                        }`}
                        onClick={() => onViewImpact(change)}
                        disabled={!cbmReady || impactLoadingId === change.id}
                        title={cbmReady ? cr.viewImpact : cr.impactCbmUnavailable}
                        data-testid="review-view-impact"
                      >
                        {impactLoadingId === change.id ? cr.viewImpactLoading : cr.viewImpact}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => onAccept(change)}
                    >
                      {cr.accept}
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => void onDiscard(change)}
                    >
                      {cr.discard}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
});

export default ChangeReviewDiffView;
