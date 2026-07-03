import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDownIcon } from '../shared/Icons';
import { useTranslation } from '../../i18n';
import {
  useRecentWorkspaces,
  useTouchRecentWorkspace,
} from '../../stores';
import type { RecentWorkspace } from '../../types/settings';
import styles from './AgentContextBar.module.css';

export interface AgentContextBarProps {
  projectPath: string;
  projectName: string;
  onSwitchProject: (path: string) => void;
  centered?: boolean;
}

function PillDropdown({
  label,
  value,
  isOpen,
  onToggle,
  children,
  readonly = false,
}: {
  label: string;
  value: string;
  isOpen: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  readonly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || readonly) return;
    const onMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, onToggle, readonly]);

  return (
    <div className={styles.pillWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.pill} ${isOpen ? styles.pillOpen : ''} ${readonly ? styles.readonlyPill : ''}`}
        onClick={() => {
          if (!readonly) onToggle();
        }}
        aria-expanded={isOpen}
      >
        <span className={styles.pillLabel}>
          {label}: {value}
        </span>
        {!readonly && <ChevronDownIcon size={10} />}
      </button>
      {isOpen && !readonly && children}
    </div>
  );
}

const AgentContextBar = memo(function AgentContextBar({
  projectPath,
  projectName,
  onSwitchProject,
  centered = false,
}: AgentContextBarProps) {
  const t = useTranslation();
  const recentWorkspaces = useRecentWorkspaces();
  const touchRecentWorkspace = useTouchRecentWorkspace();

  const [projectOpen, setProjectOpen] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);

  const projects: RecentWorkspace[] = (() => {
    const map = new Map<string, RecentWorkspace>();
    for (const workspace of recentWorkspaces) {
      map.set(workspace.path, workspace);
    }
    if (projectPath && !map.has(projectPath)) {
      map.set(projectPath, {
        path: projectPath,
        name: projectName || projectPath.split(/[\\/]/).pop() || projectPath,
        lastOpenedAt: new Date().toISOString(),
      });
    }
    return Array.from(map.values());
  })();

  useEffect(() => {
    if (!projectPath) return;
    void touchRecentWorkspace(projectPath, projectName);
  }, [projectPath, projectName, touchRecentWorkspace]);

  useEffect(() => {
    let cancelled = false;
    const loadBranch = async () => {
      if (!projectPath) {
        setBranchName(null);
        return;
      }
      try {
        const snapshot = await invoke<{
          status?: { branch?: string };
        }>('git_workspace_snapshot', { repoPath: projectPath, limit: 1 });
        if (!cancelled) {
          setBranchName(snapshot.status?.branch?.trim() || null);
        }
      } catch {
        if (!cancelled) setBranchName(null);
      }
    };
    void loadBranch();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const handleSelectProject = useCallback(
    (workspace: RecentWorkspace) => {
      setProjectOpen(false);
      if (workspace.path !== projectPath) {
        onSwitchProject(workspace.path);
      }
    },
    [onSwitchProject, projectPath]
  );

  return (
    <div className={styles.bar} style={centered ? undefined : { maxWidth: 'none' }}>
      <PillDropdown
        label={t.agent.contextBar.project}
        value={projectName || projectPath.split(/[\\/]/).pop() || '—'}
        isOpen={projectOpen}
        onToggle={() => setProjectOpen((prev) => !prev)}
      >
        <div className={styles.dropdown} role="menu">
          {projects.length === 0 ? (
            <div className={styles.item}>{t.agent.nav.noProjects}</div>
          ) : (
            projects.map((workspace) => (
              <button
                key={workspace.path}
                type="button"
                role="menuitem"
                className={`${styles.item} ${
                  workspace.path === projectPath ? styles.itemActive : ''
                }`}
                onClick={() => handleSelectProject(workspace)}
              >
                {workspace.name}
                <span className={styles.itemMeta}>{workspace.path}</span>
              </button>
            ))
          )}
        </div>
      </PillDropdown>

      <PillDropdown
        label={t.agent.contextBar.branch}
        value={branchName || t.agent.contextBar.noBranch}
        isOpen={false}
        onToggle={() => {}}
        readonly
      />
    </div>
  );
});

export default AgentContextBar;
