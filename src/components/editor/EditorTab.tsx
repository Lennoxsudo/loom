/**
 * 编辑器标签页组件
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { OpenFile } from '../../types/app';
import { useTranslation } from '../../i18n';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { BrowserGlobeIcon } from '../shared/Icons';
import styles from './EditorTab.module.css';

interface EditorTabProps {
  tabId: string;
  file: OpenFile;
  isActive: boolean;
  isHovered: boolean;
  isCloseDisabled?: boolean;
  closeDisabledTitle?: string;
  onHover: (tabId: string | null) => void;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
}

export function EditorTab({
  tabId,
  file,
  isActive,
  isHovered: _isHovered,
  isCloseDisabled = false,
  closeDisabledTitle,
  onHover,
  onActivate,
  onClose,
}: EditorTabProps) {
  const t = useTranslation();
  const defaultCloseDisabledTitle = t.editor.agentRunningCannotClose;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabId,
  });

  const handleCloseClick = (e: React.MouseEvent) => {
    if (isCloseDisabled) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    onClose(e);
  };

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  return (
    <div
      ref={setNodeRef}
      title={file.path}
      className={`${styles.tab} ${isDragging ? styles.tabDragging : ''}`}
      data-active={isActive}
      style={sortableStyle}
      onClick={onActivate}
      onMouseEnter={() => onHover(tabId)}
      onMouseLeave={() => onHover(null)}
      {...attributes}
      {...listeners}
    >
      <span className={styles.icon}>
        {file.kind === 'browser' ? (
          <BrowserGlobeIcon size={14} />
        ) : (
          <FileTypeIcon name={file.name} size={14} />
        )}
      </span>
      <span className={styles.label}>
        {file.name}
        {'isDeleted' in file && file.isDeleted && (
          <span className={styles.deletedMark} title={t.editor.fileDeletedFromDisk}>
            (已删除)
          </span>
        )}
      </span>

      {file.isDirty ? (
        <button
          type="button"
          className={styles.dirtyDot}
          disabled={isCloseDisabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleCloseClick}
          title={
            isCloseDisabled
              ? closeDisabledTitle || defaultCloseDisabledTitle
              : t.editor.unsavedChangesClickToClose
          }
        >
          •
        </button>
      ) : (
        <button
          type="button"
          className={styles.close}
          disabled={isCloseDisabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleCloseClick}
          title={isCloseDisabled ? closeDisabledTitle : undefined}
          aria-label={`${t.actions.close}${file.name}`}
        >
          <span className={styles.closeGlyph} aria-hidden>
            ×
          </span>
        </button>
      )}
    </div>
  );
}
