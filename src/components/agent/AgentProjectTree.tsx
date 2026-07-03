import { memo, useCallback, useMemo, useState } from 'react';
import { EditIcon, FolderPlusIcon, PlusIcon, TrashIcon } from '../shared/Icons';
import { useTranslation, useLocale } from '../../i18n';
import type { RecentWorkspace } from '../../types/settings';
import type { AgentThreadListItem } from './utils';
import { normalizeProjectPath } from './utils';
import SessionStreamingLoader from './SessionStreamingLoader';
import { GitPanelContextMenu, type GitPanelMenuEntry } from '../GitPanelContextMenu';
import styles from './AgentProjectTree.module.css';

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

function isProjectStreaming(
  threads: AgentThreadListItem[],
  streamingSessionKeys: Set<string>
): boolean {
  return threads.some((thread) => streamingSessionKeys.has(thread.sessionKey));
}

type ProjectContextMenuState = {
  x: number;
  y: number;
  project: RecentWorkspace;
};

export interface AgentProjectTreeProps {
  projects: RecentWorkspace[];
  threadsByProject: Record<string, AgentThreadListItem[]>;
  activeProjectPath: string;
  selectedThreadId: string | null;
  streamingSessionKeys: Set<string>;
  hideEmptyProjects: boolean;
  isExpanded: (projectPath: string) => boolean;
  onToggleExpanded: (projectPath: string) => void;
  onAddProject: () => void;
  onToggleHideEmptyProjects: () => void;
  onSelectThread: (projectPath: string, threadId: string) => void;
  onNewThreadInProject: (projectPath: string) => void;
  onRequestDeleteProject: (project: RecentWorkspace) => void;
  renamingThreadId: string | null;
  renamingTitle: string;
  onRenamingTitleChange: (value: string) => void;
  onStartRename: (threadId: string, title: string) => void;
  onCommitRename: (threadId: string) => void;
  onCancelRename: () => void;
  onRequestDelete: (thread: AgentThreadListItem) => void;
}

const AgentProjectTree = memo(function AgentProjectTree({
  projects,
  threadsByProject,
  activeProjectPath,
  selectedThreadId,
  streamingSessionKeys,
  hideEmptyProjects,
  isExpanded,
  onToggleExpanded,
  onAddProject,
  onToggleHideEmptyProjects,
  onSelectThread,
  onNewThreadInProject,
  onRequestDeleteProject,
  renamingThreadId,
  renamingTitle,
  onRenamingTitleChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
}: AgentProjectTreeProps) {
  const t = useTranslation();
  const language = useLocale();
  const activeKey = normalizeProjectPath(activeProjectPath);
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(
    null
  );

  const closeProjectContextMenu = useCallback(() => {
    setProjectContextMenu(null);
  }, []);

  const visibleProjects = hideEmptyProjects
    ? projects.filter((project) => {
        const key = normalizeProjectPath(project.path);
        return (threadsByProject[key]?.length ?? 0) > 0;
      })
    : projects;

  const contextMenuEntries = useMemo((): GitPanelMenuEntry[] => {
    if (!projectContextMenu) return [];
    const projectKey = normalizeProjectPath(projectContextMenu.project.path);
    const threads = threadsByProject[projectKey] ?? [];
    const streaming = isProjectStreaming(threads, streamingSessionKeys);
    if (streaming) {
      return [
        {
          kind: 'item',
          key: 'delete-project-blocked',
          label: t.agent.nav.deleteProjectStreamingBlocked,
          onSelect: closeProjectContextMenu,
        },
      ];
    }
    return [
      {
        kind: 'item',
        key: 'delete-project',
        label: t.agent.nav.deleteProject,
        danger: true,
        onSelect: () => {
          closeProjectContextMenu();
          onRequestDeleteProject(projectContextMenu.project);
        },
      },
    ];
  }, [
    closeProjectContextMenu,
    onRequestDeleteProject,
    projectContextMenu,
    streamingSessionKeys,
    t.agent.nav.deleteProject,
    t.agent.nav.deleteProjectStreamingBlocked,
    threadsByProject,
  ]);

  return (
    <div className={styles.tree} data-testid="agent-project-tree">
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t.agent.nav.projects}</span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.headerButton} ${hideEmptyProjects ? styles.headerButtonActive : ''}`}
            onClick={onToggleHideEmptyProjects}
            title={t.agent.nav.hideEmptyProjects}
            aria-label={t.agent.nav.filterProjects}
            aria-pressed={hideEmptyProjects}
          >
            <span className={styles.filterIcon} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.headerButton}
            onClick={onAddProject}
            title={t.agent.nav.addProject}
            aria-label={t.agent.nav.addProject}
          >
            <FolderPlusIcon size={14} aria-hidden />
          </button>
        </div>
      </div>

      {visibleProjects.length === 0 ? (
        <div className={styles.emptyProjects}>{t.agent.nav.noProjects}</div>
      ) : (
        <div className={styles.projectList}>
          {visibleProjects.map((project) => {
            const projectKey = normalizeProjectPath(project.path);
            const threads = threadsByProject[projectKey] ?? [];
            const expanded = isExpanded(project.path);
            const isActiveProject = projectKey === activeKey;

            return (
              <div key={project.path} className={styles.projectGroup}>
                <div
                  className={`${styles.projectItem} ${isActiveProject ? styles.projectItemActive : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setProjectContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      project,
                    });
                  }}
                >
                  <button
                    type="button"
                    className={styles.projectRow}
                    onClick={() => onToggleExpanded(project.path)}
                    aria-expanded={expanded}
                  >
                    <span className={styles.projectLeadingIcon}>
                      <span
                        className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
                        aria-hidden
                      />
                      <span className={styles.folderIcon} aria-hidden />
                    </span>
                    <span className={styles.projectName}>{project.name}</span>
                  </button>
                  <div className={styles.projectActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      title={t.agent.threads.newThread}
                      aria-label={t.agent.threads.newThread}
                      onClick={(event) => {
                        event.stopPropagation();
                        onNewThreadInProject(project.path);
                      }}
                    >
                      <PlusIcon size={12} />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className={styles.threadList}>
                    {threads.length === 0 ? (
                      <div className={styles.emptyThreads}>
                        <span className={styles.emptyThreadsLeading} aria-hidden />
                        <span>{t.agent.nav.noConversationsYet}</span>
                      </div>
                    ) : (
                      threads.map((thread) => {
                        const isActive = thread.id === selectedThreadId;
                        const isStreaming = streamingSessionKeys.has(thread.sessionKey);
                        const isRenaming = renamingThreadId === thread.id;

                        return (
                          <div
                            key={thread.id}
                            className={`${styles.threadItem} ${isActive ? styles.threadItemActive : ''}`}
                          >
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
                                className={styles.threadButton}
                                onClick={() => onSelectThread(project.path, thread.id)}
                              >
                                <span className={styles.threadTitleRow}>
                                  <span className={styles.threadLeading} aria-hidden={!isStreaming}>
                                    {isStreaming ? (
                                      <SessionStreamingLoader title={t.agent.threads.streaming} />
                                    ) : null}
                                  </span>
                                  <span className={styles.threadTitle}>{thread.title}</span>
                                </span>
                                <span className={styles.threadMeta}>
                                  {thread.updatedAt ? (
                                    <span className={styles.threadTime}>
                                      {formatRelativeTime(thread.updatedAt, language)}
                                    </span>
                                  ) : null}
                                  {thread.branchName ? (
                                    <span className={styles.branchIcon} title={thread.branchName} aria-hidden />
                                  ) : null}
                                </span>
                              </button>
                            )}

                            {!isRenaming && (
                              <div className={styles.threadActions}>
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
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {projectContextMenu ? (
        <GitPanelContextMenu
          x={projectContextMenu.x}
          y={projectContextMenu.y}
          onClose={closeProjectContextMenu}
          entries={contextMenuEntries}
        />
      ) : null}
    </div>
  );
});

export default AgentProjectTree;
