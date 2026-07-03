import { memo } from 'react';
import { CloseIcon } from '../shared/Icons';
import { useTranslation } from '../../i18n';
import type { AgentThreadListItem } from './hooks/useAgentThreadManager';
import styles from './AgentThreadDeleteDialog.module.css';

export interface AgentThreadDeleteDialogProps {
  pendingThread: AgentThreadListItem | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const AgentThreadDeleteDialog = memo(function AgentThreadDeleteDialog({
  pendingThread,
  isDeleting,
  onCancel,
  onConfirm,
}: AgentThreadDeleteDialogProps) {
  const t = useTranslation();

  if (!pendingThread) return null;

  const confirmText = t.agent.threads.deleteConfirm.replace('{title}', pendingThread.title);

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
          <h3 className={styles.title}>{t.agent.threads.deleteTitle}</h3>
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
        <p className={styles.hint}>{t.agent.threads.deleteHint}</p>
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

export default AgentThreadDeleteDialog;
