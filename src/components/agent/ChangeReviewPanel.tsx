import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { CloseIcon } from '../shared/Icons';
import ChangeReviewDiffView from './ChangeReviewDiffView';
import ChangeReviewFilePreview from './ChangeReviewFilePreview';
import CheckpointTimeline from './CheckpointTimeline';
import type { PendingFileChange } from './utils';
import type { AgentCheckpoint } from '../../utils/checkpointTimeline';
import { shortFileName } from '../../utils/checkpointTimeline';
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

type ReviewTab = 'files' | 'timeline';

export interface ChangeReviewPanelProps {
  projectPath: string;
  pendingChanges: PendingFileChange[];
  checkpoints?: AgentCheckpoint[];
  restoringCheckpointId?: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAccept: (change: PendingFileChange) => void;
  onDiscard: (change: PendingFileChange) => Promise<void>;
  onAcceptAll: (changes: PendingFileChange[]) => void;
  onDiscardAll: (changes: PendingFileChange[]) => Promise<void>;
  onRestoreCheckpoint?: (checkpoint: AgentCheckpoint) => Promise<void>;
}

const ChangeReviewPanel = memo(function ChangeReviewPanel({
  pendingChanges,
  checkpoints = [],
  restoringCheckpointId = null,
  collapsed,
  onToggleCollapsed,
  onAccept,
  onDiscard,
  onAcceptAll,
  onDiscardAll,
  onRestoreCheckpoint,
}: ChangeReviewPanelProps) {
  const t = useTranslation();
  const [showButton, setShowButton] = useState(false);
  const [previewChangeId, setPreviewChangeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTab>('files');
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);

  const previewChange = useMemo(
    () => pendingChanges.find((change) => change.id === previewChangeId) ?? null,
    [pendingChanges, previewChangeId]
  );

  const selectedCheckpoint = useMemo(
    () => checkpoints.find((c) => c.id === selectedCheckpointId) ?? null,
    [checkpoints, selectedCheckpointId]
  );

  useEffect(() => {
    if (collapsed) {
      setPreviewChangeId(null);
      setSelectedCheckpointId(null);
    }
  }, [collapsed]);

  useEffect(() => {
    if (previewChangeId && !pendingChanges.some((change) => change.id === previewChangeId)) {
      setPreviewChangeId(null);
    }
  }, [pendingChanges, previewChangeId]);

  useEffect(() => {
    if (
      selectedCheckpointId &&
      !checkpoints.some((c) => c.id === selectedCheckpointId)
    ) {
      setSelectedCheckpointId(null);
    }
  }, [checkpoints, selectedCheckpointId]);

  const handleSelectPreview = useCallback((change: PendingFileChange) => {
    setPreviewChangeId(change.id);
    setSelectedCheckpointId(null);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewChangeId(null);
    setSelectedCheckpointId(null);
  }, []);

  const handleSelectCheckpoint = useCallback((cp: AgentCheckpoint) => {
    setSelectedCheckpointId(cp.id);
    setPreviewChangeId(null);
  }, []);

  const handleRestore = useCallback(
    async (cp: AgentCheckpoint) => {
      if (!onRestoreCheckpoint) return;
      await onRestoreCheckpoint(cp);
      setSelectedCheckpointId(null);
    },
    [onRestoreCheckpoint]
  );

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

  const titleCount =
    activeTab === 'files'
      ? pendingChanges.length
      : checkpoints.length;

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
            {titleCount > 0 ? ` (${titleCount})` : ''}
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

        <div className={styles.tabBar} role="tablist" aria-label={t.agent.changeReview.title}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'files'}
            className={`${styles.tab} ${activeTab === 'files' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('files')}
            data-testid="change-review-tab-files"
          >
            {t.agent.changeReview.filesTab}
            {pendingChanges.length > 0 ? ` (${pendingChanges.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'timeline'}
            className={`${styles.tab} ${activeTab === 'timeline' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('timeline')}
            data-testid="change-review-tab-timeline"
          >
            {t.agent.changeReview.timelineTab}
            {checkpoints.length > 0 ? ` (${checkpoints.length})` : ''}
          </button>
        </div>

        {activeTab === 'files' ? (
          <ChangeReviewDiffView
            pendingChanges={pendingChanges}
            selectedChangeId={previewChangeId}
            onSelectPreview={handleSelectPreview}
            onAccept={onAccept}
            onDiscard={onDiscard}
            onAcceptAll={onAcceptAll}
            onDiscardAll={onDiscardAll}
          />
        ) : (
          <CheckpointTimeline
            checkpoints={checkpoints}
            restoringId={restoringCheckpointId}
            selectedId={selectedCheckpointId}
            onSelect={handleSelectCheckpoint}
            onRestore={handleRestore}
          />
        )}
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

      {selectedCheckpoint && !previewChange ? (
        <aside className={styles.previewPanel} data-testid="checkpoint-detail-preview">
          <div className={styles.header}>
            <span className={styles.title}>{t.agent.changeReview.checkpointDetail}</span>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.toggleButton}
                onClick={handleClosePreview}
                title={t.agent.changeReview.closePreview}
                aria-label={t.agent.changeReview.closePreview}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          </div>
          <div className={styles.checkpointFileList}>
            <div>
              <strong>{selectedCheckpoint.label}</strong>
            </div>
            <div>
              {t.agent.changeReview.checkpointFiles}: {selectedCheckpoint.files.length}
            </div>
            <ul>
              {selectedCheckpoint.files.map((f) => (
                <li key={f.path}>
                  {shortFileName(f.path)}
                  {!f.existed
                    ? ` (${t.agent.changeReview.fileDidNotExist})`
                    : f.isBinary
                      ? ` (${t.agent.changeReview.binarySkipped})`
                      : ''}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
});

export default ChangeReviewPanel;
