import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { isTauriCancellationError, logError, logWarning } from '../utils/errorHandling';
import { useTranslation } from '../i18n';
import styles from './TitleBar.module.css';
import IndexedProjectsMenu from './IndexedProjectsMenu';
import type { CbmIndexedProject } from '../hooks/useIndexedProjects';

let appWindowCache: ReturnType<typeof getCurrentWindow> | null | undefined = undefined;

function getAppWindow() {
  if (appWindowCache !== undefined) {
    return appWindowCache;
  }
  try {
    appWindowCache = getCurrentWindow();
  } catch (_error) {
    logWarning('Tauri window API unavailable', 'TitleBar');
    appWindowCache = null;
  }
  return appWindowCache;
}

interface TitleBarProps {
  onOpenFolder: () => void;
  onOpenFile: () => void;
  projectName?: string;
  hideMenu?: boolean;
  onOpenAgent?: () => void;
  showIndexedProjects?: boolean;
  cbmReady?: boolean;
  indexedProjects?: CbmIndexedProject[];
  indexedProjectsLoading?: boolean;
  onIndexedProjectsOpen?: () => void;
  onOpenFolderAtPath?: (path: string) => void;
  onDeleteIndexedProject?: (path: string) => void;
}

export default function TitleBar({
  onOpenFolder,
  onOpenFile,
  projectName,
  hideMenu,
  onOpenAgent,
  showIndexedProjects = false,
  cbmReady = false,
  indexedProjects = [],
  indexedProjectsLoading = false,
  onIndexedProjectsOpen,
  onOpenFolderAtPath,
  onDeleteIndexedProject,
}: TitleBarProps) {
  const t = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const appWindow = getAppWindow();

  useEffect(() => {
    if (!appWindow) {
      return;
    }

    const checkMaximized = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
      } catch (error) {
        if (!isTauriCancellationError(error)) {
          logWarning('Failed to query maximized state', 'TitleBar');
        }
      }
    };
    void checkMaximized();

    const unlisten = appWindow.onResized(() => {
      void appWindow
        .isMaximized()
        .then((maximized) => {
          setIsMaximized(maximized);
        })
        .catch((error) => {
          if (!isTauriCancellationError(error)) {
            logWarning('Failed to update maximized state', 'TitleBar');
          }
        });
    });

    const handleClickOutside = () => setIsMenuOpen(false);
    if (isMenuOpen) {
      window.addEventListener('click', handleClickOutside);
    }

    return () => {
      void unlisten
        .then((f) => f())
        .catch((error) => {
          if (!isTauriCancellationError(error)) {
            logWarning('Failed to remove resize listener', 'TitleBar');
          }
        });
      window.removeEventListener('click', handleClickOutside);
    };
  }, [appWindow, isMenuOpen]);

  const handleOpenFile = () => {
    void Promise.resolve(onOpenFile()).catch((error) => {
      logError(error, 'Open file');
    });
    setIsMenuOpen(false);
  };

  const handleOpenFolder = () => {
    void Promise.resolve(onOpenFolder()).catch((error) => {
      logError(error, 'Open folder');
    });
    setIsMenuOpen(false);
  };

  const handleMinimize = () => {
    if (!appWindow) return;
    void appWindow.minimize().catch((error) => {
      logError(error, 'Minimize window');
    });
  };

  const handleToggleMaximize = () => {
    if (!appWindow) return;
    void appWindow.toggleMaximize().catch((error) => {
      logError(error, 'Toggle maximize');
    });
  };

  const handleClose = () => {
    if (!appWindow) return;
    void appWindow.close().catch((error) => {
      logError(error, 'Close window');
    });
  };

  return (
    <div className={styles.titleBar} data-tauri-drag-region>
      <div className={styles.projectName}>{projectName || ''}</div>

      <div className={styles.leftSection}>
        <span className={styles.title}>{t.labels.appName}</span>

        {!hideMenu && (
          <div className={styles.menuContainer}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
              }}
              className={`${styles.menuButton} ${isMenuOpen ? styles.menuButtonOpen : ''}`}
            >
              {t.labels.open}
            </button>

            {isMenuOpen && (
              <div className={styles.dropdown}>
                <div className={styles.dropdownItem} onClick={handleOpenFile}>
                  {t.labels.openFile}
                </div>
                <div className={styles.dropdownItem} onClick={handleOpenFolder}>
                  {t.labels.openFolder}
                </div>
              </div>
            )}
          </div>
        )}

        {showIndexedProjects && onOpenFolderAtPath && onDeleteIndexedProject && (
          <IndexedProjectsMenu
            enabled={showIndexedProjects}
            cbmReady={cbmReady}
            projects={indexedProjects}
            loading={indexedProjectsLoading}
            onOpenMenu={() => onIndexedProjectsOpen?.()}
            onOpenProject={onOpenFolderAtPath}
            onDeleteIndex={onDeleteIndexedProject}
          />
        )}
      </div>

      <div className={styles.spacer} />

      {onOpenAgent && (
        <button
          className={styles.agentButton}
          onClick={(e) => {
            e.stopPropagation();
            onOpenAgent();
          }}
        >
          Open Agent
        </button>
      )}

      <div className={styles.windowControls}>
        <div className={styles.windowButton} onClick={handleMinimize}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <path stroke="currentColor" strokeWidth="1" fill="none" d="M1 5.5h9" />
          </svg>
        </div>
        <div className={styles.windowButton} onClick={handleToggleMaximize}>
          {isMaximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path stroke="currentColor" strokeWidth="1" fill="none" d="M3.5 1.5h6v6 M1.5 3.5h6v6h-6z" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path stroke="currentColor" strokeWidth="1" fill="none" d="M1.5 1.5h8v8h-8z" />
            </svg>
          )}
        </div>
        <div className={styles.closeButton} onClick={handleClose}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <path stroke="currentColor" strokeWidth="1" fill="none" d="M1.5 1.5l8 8 M9.5 1.5l-8 8" />
          </svg>
        </div>
      </div>
    </div>
  );
}
