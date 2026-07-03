import { memo } from 'react';
import { CloseIcon } from '../shared/Icons';
import { useTranslation } from '../../i18n';
import type { RecentWorkspace } from '../../types/settings';
import styles from './AgentThreadDeleteDialog.module.css';

export interface AgentProjectDeleteDialogProps {
  pendingProject: RecentWorkspace | null;
  threadCount: number;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const AgentProjectDeleteDialog = memo(function AgentProjectDeleteDialog({
  pendingProject,
  threadCount,
  isDeleting,
  onCancel,
  onConfirm,
}: AgentProjectDeleteDialogProps) {
  const t = useTranslation();

  if (!pendingProject) return null;

  const confirmText = t.agent.nav.deleteProjectConfirm.replace('{name}', pendingProject.name);
  const threadHint =
    threadCount > 0
      ? t.agent.nav.deleteProjectThreadCount.replace('{count}', String(threadCount))
      : '';

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => {
        if (!isDeleting) onCancel();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>{t.agent.nav.deleteProjectTitle}</h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => {
              if (!isDeleting) onCancel();
            }}
            disabled={isDeleting}
            aria-label={t.ariaLabels.close}
          >
            <CloseIcon />
          </button>
        </div>
        <p className={styles.body}>{confirmText}</p>
        {threadHint ? <p className={styles.body}>{threadHint}</p> : null}
        <p className={styles.hint}>{t.agent.nav.deleteProjectHint}</p>
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
            disabled={isDeleting}
          >
            {t.agent.threads.cancel}
          </button>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? t.common.deleting : t.common.confirmDelete}
          </button>
        </div>
      </div>
    </div>
  );
});

export default AgentProjectDeleteDialog;
