import { useMemo } from 'react';
import type { PendingFileChange } from './types';
import type { I18nMessages } from '../../i18n/types';
import { computePendingChangeLineStats } from '../agent/pendingChangeStatsUtils';
import { ChevronDownIcon } from '../shared/Icons';
import styles from './PendingChangesBar.module.css';

export interface PendingChangesBarProps {
  pendingChanges: PendingFileChange[];
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  t: I18nMessages;
  onOpenFile: (filePath: string) => void;
  onAccept: (change: PendingFileChange) => void;
  onRollback: (change: PendingFileChange) => Promise<void>;
  variant?: 'overlay' | 'inline';
}

function getShortFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

function ChangeStats({ change }: { change: PendingFileChange }) {
  const stats = useMemo(
    () =>
      computePendingChangeLineStats({
        beforeContent: change.beforeContent,
        afterContent: change.afterContent,
        toolName: change.toolName,
        oldSnippet: change.oldSnippet,
        newSnippet: change.newSnippet,
      }),
    [change]
  );

  if (stats.added === 0 && stats.removed === 0) return null;

  return (
    <span className={styles.stats}>
      {stats.added > 0 && <span className={styles.statAdded}>+{stats.added}</span>}
      {stats.added > 0 && stats.removed > 0 && ' '}
      {stats.removed > 0 && <span className={styles.statRemoved}>-{stats.removed}</span>}
    </span>
  );
}

function FileIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function PendingChangesBar({
  pendingChanges,
  collapsed,
  setCollapsed,
  t,
  onOpenFile,
  onAccept,
  onRollback,
  variant = 'overlay',
}: PendingChangesBarProps) {
  if (pendingChanges.length === 0) return null;

  const isInline = variant === 'inline';
  const visibleRows = 4;
  const listMaxHeight = `${visibleRows * 34}px`;

  return (
    <div
      className={`${styles.wrap} ${isInline ? styles.wrapInline : styles.wrapOverlay}`}
      id="chat-pending-changes"
    >
      <button
        type="button"
        className={`${styles.header} ${!collapsed ? styles.headerExpanded : ''}`}
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <span className={styles.headerIcon}>
          <FileIcon />
        </span>
        <span className={styles.title}>{t.chat.pendingChangesTitle}</span>
        <span className={styles.count}>{pendingChanges.length}</span>
        <span className={styles.toggle}>
          {collapsed ? t.chat.expandPendingChanges : t.chat.collapsePendingChanges}
          <span className={`${styles.chevron} ${collapsed ? '' : styles.chevronOpen}`}>
            <ChevronDownIcon size={9} />
          </span>
        </span>
      </button>

      {!collapsed && (
        <div
          className={`${styles.list} ${pendingChanges.length > visibleRows ? styles.listScrollable : ''}`}
          style={{ maxHeight: pendingChanges.length > visibleRows ? listMaxHeight : undefined }}
        >
          {pendingChanges.map((change) => (
            <div key={change.id} className={styles.row}>
              <div className={styles.fileArea}>
                <button
                  type="button"
                  className={styles.fileButton}
                  onClick={() => onOpenFile(change.filePath)}
                  title={change.filePath}
                >
                  {getShortFileName(change.filePath)}
                </button>
                <ChangeStats change={change} />
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionAccept}`}
                  onClick={() => onAccept(change)}
                >
                  {t.actions.accept}
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionRollback}`}
                  onClick={() => void onRollback(change)}
                >
                  {t.actions.rollback}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
