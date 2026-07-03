import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { CloseIcon } from '../shared/Icons';
import ChangeReviewDiffView from './ChangeReviewDiffView';
import ChangeReviewFilePreview from './ChangeReviewFilePreview';
import type { PendingFileChange } from './utils';
import styles from './ChangeReviewPanel.module.css';

function PanelChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className={styles.chevronIcon} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={direction === 'left' ? 'M10 12 6 8l4-4' : 'M6 4l4 4-4 4'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface ChangeReviewPanelProps {
  projectPath: string;
  pendingChanges: PendingFileChange[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAccept: (change: PendingFileChange) => void;
  onDiscard: (change: PendingFileChange) => Promise<void>;
  onAcceptAll: (changes: PendingFileChange[]) => void;
  onDiscardAll: (changes: PendingFileChange[]) => Promise<void>;
}

const ChangeReviewPanel = memo(function ChangeReviewPanel({
  pendingChanges,
  collapsed,
  onToggleCollapsed,
  onAccept,
  onDiscard,
  onAcceptAll,
  onDiscardAll,
}: ChangeReviewPanelProps) {
  const t = useTranslation();
  const [showButton, setShowButton] = useState(false);
  const [previewChangeId, setPreviewChangeId] = useState<string | null>(null);

  const previewChange = useMemo(
    () => pendingChanges.find((change) => change.id === previewChangeId) ?? null,
    [pendingChanges, previewChangeId]
  );

  useEffect(() => {
    if (collapsed) {
      setPreviewChangeId(null);
    }
  }, [collapsed]);

  useEffect(() => {
    if (previewChangeId && !pendingChanges.some((change) => change.id === previewChangeId)) {
      setPreviewChangeId(null);
    }
  }, [pendingChanges, previewChangeId]);

  const handleSelectPreview = useCallback((change: PendingFileChange) => {
    setPreviewChangeId(change.id);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewChangeId(null);
  }, []);

  useEffect(() => {
    if (!collapsed) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dock = document.querySelector('[data-testid="change-review-dock"]');
      const container = dock?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const isWithinY = y >= 0 && y <= rect.height;
      const isNearRightEdge = x >= rect.width - 80 && x < rect.width - 14 && isWithinY;

      const buttonRect = dock?.getBoundingClientRect();
      const isOverButton =
        buttonRect != null &&
        e.clientX >= buttonRect.left &&
        e.clientX <= buttonRect.right &&
        e.clientY >= buttonRect.top &&
        e.clientY <= buttonRect.bottom;

      setShowButton(isNearRightEdge || isOverButton);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [collapsed]);

  if (collapsed) {
    return (
      <div
        className={styles.dock}
        data-testid="change-review-dock"
        style={{
          opacity: showButton ? 1 : 0,
          pointerEvents: showButton ? 'auto' : 'none',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          transform: showButton ? 'translateX(0)' : 'translateX(4px)',
        }}
      >
        <aside className={`${styles.panel} ${styles.panelCollapsed}`} data-testid="change-review-panel">
          <button
            type="button"
            className={styles.toggleButton}
            onClick={onToggleCollapsed}
            title={t.agent.changeReview.expand}
            aria-label={t.agent.changeReview.expand}
          >
            <PanelChevron direction="left" />
          </button>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.dock} data-testid="change-review-dock">
      <aside className={styles.panel} data-testid="change-review-panel">
        <div className={styles.header}>
          <span className={styles.title}>
            {t.agent.changeReview.title}
            {pendingChanges.length > 0 ? ` (${pendingChanges.length})` : ''}
          </span>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.toggleButton}
              onClick={onToggleCollapsed}
              title={t.agent.changeReview.collapse}
              aria-label={t.agent.changeReview.collapse}
            >
              <PanelChevron direction="right" />
            </button>
          </div>
        </div>

        <ChangeReviewDiffView
          pendingChanges={pendingChanges}
          selectedChangeId={previewChangeId}
          onSelectPreview={handleSelectPreview}
          onAccept={onAccept}
          onDiscard={onDiscard}
          onAcceptAll={onAcceptAll}
          onDiscardAll={onDiscardAll}
        />
      </aside>

      {previewChange ? (
        <aside className={styles.previewPanel} data-testid="change-review-preview">
          <div className={styles.header}>
            <span className={styles.title}>{t.agent.changeReview.previewTitle}</span>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.toggleButton}
                onClick={handleClosePreview}
                title={t.agent.changeReview.closePreview}
                aria-label={t.agent.changeReview.closePreview}
                data-testid="change-review-close-preview"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          </div>

          <div className={styles.previewBody}>
            <ChangeReviewFilePreview change={previewChange} onClose={handleClosePreview} />
          </div>
        </aside>
      ) : null}
    </div>
  );
});

export default ChangeReviewPanel;
