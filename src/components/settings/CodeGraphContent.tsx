import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  useEnableCodeGraph,
  useFileStore,
  useGraphAutoIndexMaxFiles,
  useGraphAutoIndexOnOpen,
  useUpdateEnableCodeGraph,
  useUpdateGraphAutoIndexMaxFiles,
  useUpdateGraphAutoIndexOnOpen,
} from '../../stores';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import {
  useCbmGraphReady,
  useCbmProjects,
  useCbmSidecarState,
} from '../../stores/useCbmStore';
import { CBM_DEFAULT_AUTO_INDEX_MAX_FILES, CBM_UI_URL, formatBytes } from '../../config/cbm';
import {
  deleteCbmWorkspaceIndex,
  fetchCbmStorageInfo,
  fetchCbmUiStatus,
  startCbmUiServer,
  cbmIndexedProjectKey,
  reindexCbmWorkspaceIndex,
  getCbmScheduleOutcome,
} from '../../utils/cbmRuntime';
import { normalizePathForCompare } from '../../utils/pathUtils';
import {
  getCbmStorageCache,
  hasCbmStorageFetchAttempted,
  setCbmStorageCache,
} from '../../utils/cbmStorageCache';
import { browserController } from '../../utils/browserController';
import styles from './CodeGraphContent.module.css';

const MAX_FILE_PRESETS = [0, 10_000, 50_000, 100_000] as const;

function ToggleSwitch({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      disabled={disabled}
      className={`${styles.toggleSwitch} ${active ? styles.toggleSwitchOn : ''}`}
      onClick={onClick}
    />
  );
}

function SegmentButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${styles.segmentBtn} ${active ? styles.segmentBtnActive : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CodeGraphContent() {
  const t = useTranslation();
  const { showError, showInfo, showWarning } = useNotification();
  const projectPath = useFileStore((s) => s.projectPath);
  const projectName = useFileStore((s) => s.projectName);
  const enableCodeGraph = useEnableCodeGraph();
  const graphAutoIndexOnOpen = useGraphAutoIndexOnOpen();
  const graphAutoIndexMaxFiles = useGraphAutoIndexMaxFiles();
  const updateEnableCodeGraph = useUpdateEnableCodeGraph();
  const updateGraphAutoIndexOnOpen = useUpdateGraphAutoIndexOnOpen();
  const updateGraphAutoIndexMaxFiles = useUpdateGraphAutoIndexMaxFiles();
  const { available: cbmSidecarAvailable, checked: cbmChecked, versionMismatch: cbmVersionMismatch } = useCbmSidecarState();
  const cbmGraphEnabled = useCbmGraphReady(enableCodeGraph);
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    refresh: refreshProjects,
    loadAndReconcile,
    deleteProject: deleteIndex,
  } = useCbmProjects();

  const [isSaving, setIsSaving] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageInfo, setStorageInfo] = useState(() => getCbmStorageCache());
  const [uiRunning, setUiRunning] = useState(false);
  const [uiLoading, setUiLoading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);

  const loadStorageInfo = useCallback(async (force = false) => {
    if (!force && hasCbmStorageFetchAttempted()) {
      setStorageInfo(getCbmStorageCache());
      return;
    }

    setStorageLoading(true);
    try {
      const info = await fetchCbmStorageInfo();
      const next = info
        ? {
            cacheDir: info.cacheDir,
            totalBytes: info.totalBytes,
          }
        : null;
      setCbmStorageCache(next);
      setStorageInfo(next);
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cbmGraphEnabled) {
      setUiRunning(false);
      return;
    }
    void loadStorageInfo(false);
    void fetchCbmUiStatus().then((status) => setUiRunning(Boolean(status?.running)));
  }, [cbmGraphEnabled, loadStorageInfo]);

  const runToggle = async (action: () => Promise<void>) => {
    setIsSaving(true);
    try {
      await action();
    } catch {
      showError(t.errors.updateFailed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenGraphUi = async () => {
    setUiLoading(true);
    try {
      const status = await startCbmUiServer();
      setUiRunning(true);
      const targetUrl = status.url || CBM_UI_URL;
      browserController.open(targetUrl);
      queueMicrotask(() => browserController.navigate(targetUrl));
      showInfo(t.graph.uiOpened);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      showError(detail.includes('fetch:cbm') ? detail : t.graph.uiStartFailed);
    } finally {
      setUiLoading(false);
    }
  };

  const handleCleanupStale = async () => {
    const { cleanedNames } = await loadAndReconcile(enableCodeGraph);
    for (const name of cleanedNames) {
      showInfo(t.graph.indexedProjectsStale.replace('{name}', name));
    }
    await loadStorageInfo(true);
    showInfo(t.graph.cleanupStaleDone);
  };

  const handleDeleteAllIndexes = async () => {
    const ok = await confirm(t.graph.deleteAllConfirm);
    if (!ok) return;
    for (const project of projects) {
      try {
        await deleteCbmWorkspaceIndex(project.repo_path, true);
      } catch {
        // best-effort batch delete
      }
    }
    await refreshProjects();
    await loadStorageInfo(true);
    showInfo(t.graph.deleteAllDone);
  };

  const normalizedProjectPath = projectPath.trim();
  const currentProjectIndexing = normalizedProjectPath
    ? projects.some(
        (project) =>
          normalizePathForCompare(project.repo_path) ===
            normalizePathForCompare(normalizedProjectPath) &&
          project.index_status === 'indexing',
      )
    : false;

  const handleReindexCurrentProject = async () => {
    if (!normalizedProjectPath || !cbmGraphEnabled) return;
    setIsReindexing(true);
    try {
      const result = await reindexCbmWorkspaceIndex(normalizedProjectPath, {
        maxFiles: graphAutoIndexMaxFiles > 0 ? graphAutoIndexMaxFiles : undefined,
      });
      const outcome = getCbmScheduleOutcome(result);
      const displayName = projectName.trim() || normalizedProjectPath.split(/[\\/]/).pop() || '';

      switch (outcome) {
        case 'scheduled':
          showInfo(t.graph.reindexScheduled.replace('{name}', displayName));
          break;
        case 'in_progress':
          showInfo(t.graph.reindexInProgress);
          break;
        case 'skipped_too_large':
          showWarning(t.graph.projectTooLarge);
          break;
        case 'skipped_unavailable':
          showError(t.graph.sidecarUnavailable);
          break;
        default:
          showError(t.errors.updateFailed);
          break;
      }

      await refreshProjects();
    } catch {
      showError(t.errors.updateFailed);
    } finally {
      setIsReindexing(false);
    }
  };

  const reindexDisabled =
    !cbmGraphEnabled ||
    !normalizedProjectPath ||
    isReindexing ||
    currentProjectIndexing;

  const sidecarStatusText = !cbmChecked
    ? t.common.loading
    : cbmSidecarAvailable
      ? t.graph.sidecarReady
      : cbmVersionMismatch
        ? t.graph.versionMismatch
        : t.graph.sidecarMissing;

  const sidecarStatusClass = !cbmChecked
    ? styles.statusDotLoading
    : cbmSidecarAvailable
      ? styles.statusDotReady
      : styles.statusDotMissing;

  const storageSizeLine =
    storageInfo &&
    (t.graph.storageUsage.split(' · ')[0] ?? t.graph.storageUsage).replace(
      '{size}',
      formatBytes(storageInfo.totalBytes),
    );

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{t.graph.settingsTitle}</h2>
        <p className={styles.pageStatus}>
          <span className={`${styles.statusDot} ${sidecarStatusClass}`} aria-hidden />
          {sidecarStatusText}
        </p>
      </header>

      <div className={styles.workspaceSection}>
        <p className={styles.sectionLabel}>{t.graph.currentWorkspaceTitle}</p>
        <div className={styles.panel}>
          <div className={styles.workspaceRow}>
            <div className={styles.workspaceInfo}>
              <p className={styles.panelIntro}>{t.graph.currentWorkspaceDesc}</p>
              {normalizedProjectPath ? (
                <>
                  <p className={styles.workspaceName}>
                    {projectName.trim() || normalizedProjectPath.split(/[\\/]/).pop()}
                  </p>
                  <p className={styles.workspacePath} title={normalizedProjectPath}>
                    {normalizedProjectPath}
                  </p>
                </>
              ) : (
                <p className={styles.workspaceEmpty}>{t.graph.noWorkspaceOpen}</p>
              )}
            </div>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={reindexDisabled}
              onClick={() => void handleReindexCurrentProject()}
            >
              {isReindexing || currentProjectIndexing
                ? t.graph.indexedProjectsIndexing
                : t.graph.reindexCurrentProject}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.sectionGrid}>
        <div>
          <p className={styles.sectionLabel}>{t.graph.enableCodeGraph}</p>
          <div className={styles.panel}>
            <p className={styles.panelIntro}>
              {t.graph.enableCodeGraphDesc} · {t.graph.graphAutoIndexOnOpenDesc}
            </p>
            <div className={styles.toggleList}>
              <div className={styles.toggleRow}>
                <div className={styles.toggleLabel}>{t.graph.enableCodeGraph}</div>
                <ToggleSwitch
                  active={enableCodeGraph}
                  disabled={isSaving}
                  label={t.graph.enableCodeGraph}
                  onClick={() => runToggle(() => updateEnableCodeGraph(!enableCodeGraph))}
                />
              </div>
              <div className={styles.toggleRow}>
                <div className={styles.toggleLabel}>{t.graph.graphAutoIndexOnOpen}</div>
                <ToggleSwitch
                  active={graphAutoIndexOnOpen}
                  disabled={isSaving || !enableCodeGraph}
                  label={t.graph.graphAutoIndexOnOpen}
                  onClick={() => runToggle(() => updateGraphAutoIndexOnOpen(!graphAutoIndexOnOpen))}
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className={styles.sectionLabel}>{t.graph.maxFilesTitle}</p>
          <div className={styles.panel}>
            <p className={styles.panelIntro}>{t.graph.maxFilesDesc}</p>
            <div className={styles.segmentWrap}>
              <div className={styles.segment}>
                {MAX_FILE_PRESETS.map((preset) => (
                  <SegmentButton
                    key={preset}
                    active={graphAutoIndexMaxFiles === preset}
                    disabled={isSaving || !enableCodeGraph}
                    onClick={() => runToggle(() => updateGraphAutoIndexMaxFiles(preset))}
                  >
                    {preset === 0
                      ? t.graph.maxFilesUnlimited
                      : t.graph.maxFilesPreset.replace('{count}', preset.toLocaleString())}
                  </SegmentButton>
                ))}
              </div>
            </div>
            <p className={styles.segmentFootnote}>
              {t.graph.maxFilesCurrent.replace(
                '{count}',
                graphAutoIndexMaxFiles > 0
                  ? graphAutoIndexMaxFiles.toLocaleString()
                  : t.graph.maxFilesUnlimited,
              )}
              {graphAutoIndexMaxFiles === 0
                ? ''
                : ` · ${t.graph.maxFilesDefaultHint.replace('{count}', CBM_DEFAULT_AUTO_INDEX_MAX_FILES.toLocaleString())}`}
            </p>
          </div>
        </div>

        <div>
          <p className={styles.sectionLabel}>{t.graph.storageTitle}</p>
          <div className={styles.panel}>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoDesc}>
                  {storageLoading ? (
                    t.common.loading
                  ) : storageInfo ? (
                    <span className={styles.statValue}>{storageSizeLine}</span>
                  ) : (
                    t.graph.storageUnavailable
                  )}
                </p>
                {storageInfo && (
                  <p className={styles.infoMeta}>{storageInfo.cacheDir}</p>
                )}
              </div>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={!cbmGraphEnabled || storageLoading}
                onClick={() => void loadStorageInfo(true)}
              >
                {t.graph.refreshStorage}
              </button>
            </div>
          </div>
        </div>

        <div>
          <p className={styles.sectionLabel}>{t.graph.uiTitle}</p>
          <div className={styles.panel}>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoDesc}>{t.graph.uiDesc}</p>
              </div>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={!cbmGraphEnabled || uiLoading}
                onClick={() => void handleOpenGraphUi()}
              >
                {uiLoading ? t.common.loading : uiRunning ? t.graph.uiOpenAgain : t.graph.openUi}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.projectsSection}>
        <div className={styles.projectsHeader}>
          <p className={styles.sectionLabel}>{t.graph.indexedProjectsManage}</p>
          {cbmGraphEnabled && projects.length > 0 ? (
            <span className={styles.projectsCount}>{projects.length}</span>
          ) : null}
        </div>
        <p className={styles.projectsDesc}>{t.graph.indexedProjectsManageDesc}</p>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={!cbmGraphEnabled || projectsLoading}
            onClick={() => void handleCleanupStale()}
          >
            {t.graph.cleanupStale}
          </button>
          <button
            type="button"
            className={`${styles.ghostBtn} ${styles.ghostBtnDanger}`}
            disabled={!cbmGraphEnabled || projects.length === 0}
            onClick={() => void handleDeleteAllIndexes()}
          >
            {t.graph.deleteAllIndexes}
          </button>
        </div>

        {!cbmGraphEnabled ? (
          <p className={styles.emptyState}>{t.graph.sidecarUnavailable}</p>
        ) : projectsError ? (
          <div className={styles.errorBlock}>
            <p className={styles.emptyState}>{t.graph.projectsLoadFailed}</p>
            <p className={styles.errorDetail}>{projectsError}</p>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => void refreshProjects()}
            >
              {t.graph.retryLoadProjects}
            </button>
          </div>
        ) : projectsLoading && projects.length === 0 ? (
          <p className={styles.emptyState}>{t.common.loading}</p>
        ) : projects.length === 0 ? (
          <p className={styles.emptyState}>{t.graph.indexedProjectsEmpty}</p>
        ) : (
          <div className={styles.projectList}>
            {projects.map((project, index) => {
              const badge =
                project.index_status === 'indexing'
                  ? { label: t.graph.indexedProjectsIndexing, className: styles.projectBadgeIndexing }
                  : project.path_status !== 'ok'
                    ? { label: t.graph.indexedProjectsStaleShort, className: styles.projectBadgeStale }
                    : project.is_stale
                      ? { label: t.graph.indexedProjectsStaleUnused, className: styles.projectBadgeStale }
                      : project.node_count != null
                        ? {
                            label: t.graph.nodeCount.replace('{count}', String(project.node_count)),
                            className: styles.projectBadge,
                          }
                        : null;

              return (
                <div key={cbmIndexedProjectKey(project, index)} className={styles.projectRow}>
                  <div className={styles.projectInfo}>
                    <div className={styles.projectNameRow}>
                      <span className={styles.projectName}>{project.display_name}</span>
                      {badge ? (
                        <span className={badge.className}>{badge.label}</span>
                      ) : null}
                    </div>
                    <div className={styles.projectPath} title={project.repo_path}>
                      {project.repo_path}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm(t.graph.indexedProjectsDeleteConfirm);
                        if (!ok) return;
                        try {
                          await deleteIndex(project.repo_path, enableCodeGraph);
                          showInfo(t.graph.indexDeleted);
                          setUiRunning(false);
                          await loadStorageInfo(true);
                        } catch {
                          showError(t.graph.indexDeleteFailed);
                        }
                      })();
                    }}
                  >
                    {t.graph.indexedProjectsDelete}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
