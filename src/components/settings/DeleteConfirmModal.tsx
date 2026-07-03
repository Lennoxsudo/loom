import { useTranslation } from '../../i18n';
import { SettingsDeleteModal } from './SettingsDeleteModal';

export function DeleteConfirmModal({
  isOpen,
  promptName,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  promptName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();
  if (!isOpen) return null;

  return (
    <SettingsDeleteModal
      title={t.confirm.deleteFile}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {t.confirm.irreversible.replace('此操作', `删除提示词"${promptName}"`)}
    </SettingsDeleteModal>
  );
}
