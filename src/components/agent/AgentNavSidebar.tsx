import { memo, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { RecentWorkspace } from '../../types/settings';
import AgentProjectTree from './AgentProjectTree';
import type { AgentThreadListItem } from './utils';
import { normalizeProjectPath } from './utils';
import { NewConversationIcon, SettingsIcon } from '../shared/Icons';
import { AgentSettingsNav } from '../settings/AgentSettingsNav';
import type { AgentSettingsSection } from '../settings/AgentContent';
import styles from './AgentNavSidebar.module.css';

export type AgentSidebarMode = 'workspace' | 'settings';

export interface AgentNavSidebarProps {
  projectPath: string;
  projectName: string;
  recentWorkspaces: RecentWorkspace[];
  threadsByProject: Record<string, AgentThreadListItem[]>;
  selectedThreadId: string | null;
  streamingSessionKeys: Set<string>;
  hideEmptyProjects: boolean;
  isProjectExpanded: (projectPath: string) => boolean;
  onToggleProjectExpanded: (projectPath: string) => void;
  onToggleHideEmptyProjects: () => void;
  onAddProject: () => void;
  renamingThreadId: string | null;
  renamingTitle: string;
  onRenamingTitleChange: (value: string) => void;
  onNewThread: () => void;
  onAutomation: () => void;
  onSelectThreadInProject: (projectPath: string, threadId: string) => void;
  onNewThreadInProject: (projectPath: string) => void;
  onStartRenameThread: (threadId: string, title: string) => void;
  onCommitRenameThread: (threadId: string) => void;
  onCancelRenameThread: () => void;
  onRequestDeleteThread: (thread: AgentThreadListItem) => void;
  onRequestDeleteProject: (project: RecentWorkspace) => void;
  sidebarMode: AgentSidebarMode;
  settingsSection: AgentSettingsSection;
  onSettingsSectionChange: (section: AgentSettingsSection) => void;
  onOpenSettings: () => void;
  onExitSettings: () => void;
}

const AgentNavSidebar = memo(function AgentNavSidebar({
  projectPath,
  projectName,
  recentWorkspaces,
  threadsByProject,
  selectedThreadId,
  streamingSessionKeys,
  hideEmptyProjects,
  isProjectExpanded,
  onToggleProjectExpanded,
  onToggleHideEmptyProjects,
  onAddProject,
  renamingThreadId,
  renamingTitle,
  onRenamingTitleChange,
  onNewThread,
  onAutomation,
  onSelectThreadInProject,
  onNewThreadInProject,
  onStartRenameThread,
  onCommitRenameThread,
  onCancelRenameThread,
  onRequestDeleteThread,
  onRequestDeleteProject,
  sidebarMode,
  settingsSection,
  onSettingsSectionChange,
  onOpenSettings,
  onExitSettings,
}: AgentNavSidebarProps) {
  const t = useTranslation();

  const projects = useMemo(() => {
    const map = new Map<string, RecentWorkspace>();
    for (const workspace of recentWorkspaces) {
      const key = normalizeProjectPath(workspace.path);
      if (!map.has(key)) {
        map.set(key, workspace);
      }
    }
    const activeKey = normalizeProjectPath(projectPath);
    if (projectPath && !map.has(activeKey)) {
      map.set(activeKey, {
        path: projectPath,
        name: projectName,
        lastOpenedAt: new Date().toISOString(),
      });
    }
    for (const [key, threads] of Object.entries(threadsByProject)) {
      if (threads.length === 0 || map.has(key)) continue;
      const samplePath = threads[0]?.projectPath?.trim() || key;
      map.set(key, {
        path: samplePath,
        name: samplePath.split(/[\\/]/).filter(Boolean).pop() || samplePath,
        lastOpenedAt: '',
      });
    }
    return Array.from(map.values());
  }, [projectPath, projectName, recentWorkspaces, threadsByProject]);

  return (
    <nav className={styles.sidebar} data-testid="agent-nav-sidebar">
      {sidebarMode === 'workspace' ? (
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.actionButton}
            data-testid="agent-new-thread-button"
            onClick={() => onNewThread()}
          >
            <NewConversationIcon size={16} className={styles.actionIcon} />
            {t.agent.nav.newConversation}
          </button>
          <button type="button" className={styles.actionButton} onClick={onAutomation}>
            <span className={styles.icon}>◷</span>
            {t.agent.nav.automation}
          </button>
        </div>
      ) : null}

      <div className={styles.scrollArea}>
        {sidebarMode === 'settings' ? (
          <div className={styles.settingsNavWrap}>
            <AgentSettingsNav
              activeSection={settingsSection}
              onSectionChange={onSettingsSectionChange}
            />
          </div>
        ) : (
          <AgentProjectTree
            projects={projects}
            threadsByProject={threadsByProject}
            activeProjectPath={projectPath}
            selectedThreadId={selectedThreadId}
            streamingSessionKeys={streamingSessionKeys}
            hideEmptyProjects={hideEmptyProjects}
            isExpanded={isProjectExpanded}
            onToggleExpanded={onToggleProjectExpanded}
            onAddProject={onAddProject}
            onToggleHideEmptyProjects={onToggleHideEmptyProjects}
            onSelectThread={onSelectThreadInProject}
            onNewThreadInProject={onNewThreadInProject}
            renamingThreadId={renamingThreadId}
            renamingTitle={renamingTitle}
            onRenamingTitleChange={onRenamingTitleChange}
            onStartRename={onStartRenameThread}
            onCommitRename={onCommitRenameThread}
            onCancelRename={onCancelRenameThread}
            onRequestDelete={onRequestDeleteThread}
            onRequestDeleteProject={onRequestDeleteProject}
          />
        )}
      </div>

      <div className={styles.footer}>
        {sidebarMode === 'settings' ? (
          <button type="button" className={styles.settingsButton} onClick={onExitSettings}>
            <NewConversationIcon size={14} className={styles.settingsIcon} />
            {t.agent.nav.backToChat}
          </button>
        ) : (
          <button type="button" className={styles.settingsButton} onClick={onOpenSettings}>
            <SettingsIcon size={14} className={styles.settingsIcon} />
            {t.agent.nav.settings}
          </button>
        )}
      </div>
    </nav>
  );
});

export default AgentNavSidebar;
