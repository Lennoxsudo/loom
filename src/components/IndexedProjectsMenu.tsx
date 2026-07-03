import { useEffect, useRef, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useTranslation } from '../i18n';
import type { CbmIndexedProject } from '../hooks/useIndexedProjects';
import { cbmIndexedProjectKey } from '../utils/cbmRuntime';
import styles from './IndexedProjectsMenu.module.css';

interface IndexedProjectsMenuProps {
  enabled: boolean;
  cbmReady: boolean;
  projects: CbmIndexedProject[];
  loading: boolean;
  onOpenMenu: () => void;
  onOpenProject: (repoPath: string) => void;
  onDeleteIndex: (repoPath: string) => void;
}

export default function IndexedProjectsMenu({
  enabled,
  cbmReady,
  projects,
  loading,
  onOpenMenu,
  onOpenProject,
  onDeleteIndex,
}: IndexedProjectsMenuProps) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [open]);

  if (!enabled) return null;

  const handleToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    const next = !open;
    setOpen(next);
    if (next) {
      onOpenMenu();
    }
  };

  const handleOpenProject = (project: CbmIndexedProject) => {
    if (project.path_status !== 'ok') {
      void onDeleteIndex(project.repo_path);
      setOpen(false);
      return;
    }
    onOpenProject(project.repo_path);
    setOpen(false);
  };

  return (
    <div className={styles.menuContainer} ref={containerRef}>
      <button
        type="button"
        className={`${styles.menuButton} ${open ? styles.menuButtonOpen : ''}`}
        disabled={!cbmReady}
        title={cbmReady ? t.graph.indexedProjects : t.graph.sidecarUnavailable}
        onClick={handleToggle}
      >
        {t.graph.indexedProjects} ▾
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownHeader}>{t.graph.title}</div>
          {!cbmReady ? (
            <div className={styles.emptyRow}>{t.graph.sidecarUnavailable}</div>
          ) : loading && projects.length === 0 ? (
            <div className={styles.emptyRow}>{t.common.loading}</div>
          ) : projects.length === 0 ? (
            <div className={styles.emptyRow}>{t.graph.indexedProjectsEmpty}</div>
          ) : (
            projects.map((project, index) => (
              <div key={cbmIndexedProjectKey(project, index)} className={styles.projectRow}>
                <button
                  type="button"
                  className={styles.projectMain}
                  onClick={() => handleOpenProject(project)}
                >
                  <span className={styles.projectName}>
                    {project.display_name}
                    {project.index_status === 'indexing' ? (
                      <span className={styles.badge}>{t.graph.indexedProjectsIndexing}</span>
                    ) : null}
                  </span>
                  <span className={styles.projectPath}>{project.repo_path}</span>
                </button>
                <button
                  type="button"
                  className={styles.deleteButton}
                  title={t.graph.indexedProjectsDelete}
                  onClick={(event) => {
                    event.stopPropagation();
                    void (async () => {
                      const ok = await confirm(t.graph.indexedProjectsDeleteConfirm);
                      if (!ok) return;
                      void onDeleteIndex(project.repo_path);
                    })();
                  }}
                >
                  {t.graph.indexedProjectsDelete}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
