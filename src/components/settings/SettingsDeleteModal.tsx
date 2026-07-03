import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import pageStyles from './SettingsPage.module.css';

export function SettingsDeleteModal({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled = false,
  cancelDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}) {
  const t = useTranslation();

  return (
    <div className={pageStyles.deleteModal} onClick={cancelDisabled ? undefined : onCancel}>
      <div className={pageStyles.deleteModalContent} onClick={(e) => e.stopPropagation()}>
        <div className={pageStyles.deleteModalTitle}>{title}</div>
        <div className={pageStyles.deleteModalText}>{children}</div>
        <div className={pageStyles.deleteModalButtons}>
          <button
            type="button"
            className={pageStyles.cancelButton}
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            {t.actions.cancel}
          </button>
          <button
            type="button"
            className={pageStyles.confirmDeleteButton}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel ?? t.actions.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
