import { memo } from 'react';
import { EditIcon, TrashIcon } from '../shared/Icons';
import { useTranslation, useLocale } from '../../i18n';
import type { AgentThreadListItem } from './hooks/useAgentThreadManager';
import SessionStreamingLoader from './SessionStreamingLoader';
import styles from './AgentThreadList.module.css';

function formatRelativeTime(timestamp: number | undefined, locale: string): string {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return locale.startsWith('zh') ? `${weeks} 周` : `${weeks}w`;
}

export interface AgentThreadListProps {
  threads: AgentThreadListItem[];
  selectedThreadId: string | null;
  streamingSessionKeys: Set<string>;
  renamingThreadId: string | null;
  renamingTitle: string;
  onRenamingTitleChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onStartRename: (threadId: string, title: string) => void;
  onCommitRename: (threadId: string) => void;
  onCancelRename: () => void;
  onRequestDelete: (thread: AgentThreadListItem) => void;
}

const AgentThreadList = memo(function AgentThreadList({
  threads,
  selectedThreadId,
  streamingSessionKeys,
  renamingThreadId,
  renamingTitle,
  onRenamingTitleChange,
  onSelectThread,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
}: AgentThreadListProps) {
  const t = useTranslation();
  const language = useLocale();

  if (threads.length === 0) {
    return (
      <div className={styles.empty} data-testid="agent-thread-list-empty">
        <span className={styles.emptyLeading} aria-hidden />
        <span>{t.agent.threads.empty}</span>
      </div>
    );
  }

  return (
    <div className={styles.list} data-testid="agent-thread-list">
      {threads.map((thread) => {
        const isActive = thread.id === selectedThreadId;
        const isStreaming = streamingSessionKeys.has(thread.sessionKey);
        const isRenaming = renamingThreadId === thread.id;

        return (
          <div key={thread.id} className={`${styles.item} ${isActive ? styles.itemActive : ''}`}>
            {isRenaming ? (
              <input
                className={styles.renameInput}
                value={renamingTitle}
                onChange={(event) => onRenamingTitleChange(event.target.value)}
                onBlur={() => onCommitRename(thread.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommitRename(thread.id);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancelRename();
                  }
                }}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={styles.mainButton}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className={styles.titleRow}>
                  <span className={styles.leading} aria-hidden={!isStreaming}>
                    {isStreaming ? (
                      <SessionStreamingLoader title={t.agent.threads.streaming} />
                    ) : null}
                  </span>
                  <span className={styles.title}>{thread.title}</span>
                </span>
                {thread.preview && <span className={styles.preview}>{thread.preview}</span>}
                <span className={styles.meta}>
                  {thread.branchName && (
                    <span>
                      {t.agent.threads.branch}: {thread.branchName}
                    </span>
                  )}
                  {thread.updatedAt ? (
                    <span>{formatRelativeTime(thread.updatedAt, language)}</span>
                  ) : null}
                </span>
              </button>
            )}

            {!isRenaming && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  title={t.agent.threads.rename}
                  aria-label={t.agent.threads.rename}
                  onClick={() => onStartRename(thread.id, thread.title)}
                >
                  <EditIcon size={12} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  title={t.agent.threads.delete}
                  aria-label={t.agent.threads.delete}
                  onClick={() => onRequestDelete(thread)}
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default AgentThreadList;
