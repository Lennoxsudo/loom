import { confirm } from '@tauri-apps/plugin-dialog';
import { useTranslation } from '../i18n';
import type { CbmIndexedProject } from '../hooks/useIndexedProjects';
import { cbmIndexedProjectKey } from '../utils/cbmRuntime';
import { FileTypeIcon } from './shared/FileTypeIcon';
import styles from './IndexedProjectsExplorerList.module.css';

interface IndexedProjectsExplorerListProps {
  enabled: boolean;
  cbmReady: boolean;
  projects: CbmIndexedProject[];
  loading: boolean;
  onOpenProject: (repoPath: string) => void;
  onDeleteIndex: (repoPath: string) => void;
}

export function IndexedProjectsExplorerList({
  enabled,
  cbmReady,
  projects,
  loading,
  onOpenProject,
  onDeleteIndex,
}: IndexedProjectsExplorerListProps) {
  const t = useTranslation();

  if (!enabled) return null;

  const handleOpenProject = (project: CbmIndexedProject) => {
    if (project.path_status !== 'ok') {
      void onDeleteIndex(project.repo_path);
      return;
    }
    onOpenProject(project.repo_path);
  };

  return (
    <div className={styles.root}>
      <div className={styles.sectionLabel}>{t.graph.indexedProjects}</div>

      {!cbmReady ? (
        <p className={styles.hint}>{t.graph.sidecarUnavailable}</p>
      ) : loading && projects.length === 0 ? (
        <p className={styles.hint}>{t.common.loading}</p>
      ) : projects.length === 0 ? (
        <p className={styles.hint}>{t.graph.indexedProjectsEmpty}</p>
      ) : (
        <ul className={styles.list}>
          {projects.map((project, index) => (
            <li key={cbmIndexedProjectKey(project, index)} className={styles.row}>
              <button
                type="button"
                className={styles.openButton}
                title={project.repo_path}
                onClick={() => handleOpenProject(project)}
              >
                <FileTypeIcon name={project.display_name} isDir />
                <span className={styles.name}>{project.display_name}</span>
                {project.index_status === 'indexing' ? (
                  <span className={styles.badge}>{t.graph.indexedProjectsIndexing}</span>
                ) : null}
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
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
