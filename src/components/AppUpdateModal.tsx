import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useTranslation } from '../i18n';
import { useNotification } from '../contexts/NotificationContext';
import { useAppUpdateState } from '../stores';
import { useAppUpdateStore } from '../stores/useAppUpdateStore';
import styles from './AppUpdateModal.module.css';

const IGNORED_VERSION_KEY = 'loom.update.ignoredVersion';

function formatProgress(downloaded: number, total: number | null): { percent: number; detail: string } {
  if (!total || total <= 0) {
    return { percent: 0, detail: '0%' };
  }
  const percent = Math.min(100, Math.round((downloaded / total) * 100));
  const toMB = (n: number) => (n / 1024 / 1024).toFixed(1);
  return {
    percent,
    detail: `${percent}% (${toMB(downloaded)} MB / ${toMB(total)} MB)`,
  };
}

export function AppUpdateModal() {
  const t = useTranslation();
  const { showInfo, showError } = useNotification();
  const {
    currentVersion,
    status,
    availableVersion,
    notes,
    downloadedBytes,
    contentLength,
    error,
    downloadAndInstall,
  } = useAppUpdateState();

  const [ignoredVersion, setIgnoredVersion] = useState<string | null>(null);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(IGNORED_VERSION_KEY);
    setIgnoredVersion(stored || null);
  }, []);

  useEffect(() => {
    if (status !== 'available') {
      setDismissedToken(null);
      return;
    }
    if (availableVersion && dismissedToken && dismissedToken !== availableVersion) {
      setDismissedToken(null);
    }
  }, [availableVersion, dismissedToken, status]);

  const progress = useMemo(
    () => formatProgress(downloadedBytes, contentLength),
    [downloadedBytes, contentLength]
  );

  const token = status === 'available' ? availableVersion || 'available' : status;
  const isHiddenByIgnore = status === 'available' && !!availableVersion && ignoredVersion === availableVersion;
  const isVisibleStatus =
    status === 'available' ||
    status === 'downloading' ||
    status === 'installing' ||
    status === 'restartRequired' ||
    status === 'error';
  const isOpen =
    isTauri() &&
    isVisibleStatus &&
    !isHiddenByIgnore &&
    (status === 'downloading' || status === 'installing' || dismissedToken !== token);

  if (!isOpen) return null;

  const statusTitle =
    status === 'downloading'
      ? t.settingsUpdate.downloading.replace('{percent}', String(progress.percent))
      : status === 'installing'
        ? t.settingsUpdate.installing
        : status === 'restartRequired'
          ? t.settingsUpdate.restartRequired
          : status === 'error'
            ? error || t.settingsUpdate.downloadFailed
            : t.settingsUpdate.available.replace('{version}', availableVersion ?? '');

  const desc =
    status === 'error'
      ? error || t.settingsUpdate.downloadFailed
      : status === 'restartRequired'
        ? t.settingsUpdate.restartRequired
        : status === 'installing'
          ? t.settingsUpdate.installing
          : status === 'downloading'
            ? t.settingsUpdate.downloading.replace('{percent}', String(progress.percent))
            : t.settingsUpdate.description;

  const badgeClass =
    status === 'error'
      ? styles.badgeError
      : status === 'downloading' || status === 'installing'
        ? styles.badgeBusy
        : styles.badgeReady;

  const canDismiss = status === 'available' || status === 'restartRequired' || status === 'error';
  const showProgress = status === 'downloading';
  const showNotes = Boolean(notes) && (status === 'available' || status === 'downloading' || status === 'installing');

  const handleDismiss = () => {
    if (!canDismiss) return;
    setDismissedToken(token);
  };

  const handleIgnoreVersion = () => {
    if (!availableVersion) return;
    setIgnoredVersion(availableVersion);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(IGNORED_VERSION_KEY, availableVersion);
    }
    setDismissedToken(token);
  };

  const handlePrimaryAction = async () => {
    if (status === 'available' || status === 'error') {
      await downloadAndInstall();
      const state = useAppUpdateStore.getState();
      if (state.status === 'error') {
        showError(state.error || t.settingsUpdate.downloadFailed);
      }
      return;
    }
    if (status === 'restartRequired') {
      showInfo(t.settingsUpdate.restartRequired);
      setDismissedToken(token);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="app-update-modal-title">
      <section className={styles.modal}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Loom desktop update</p>
            <h2 className={styles.title} id="app-update-modal-title">
              {statusTitle}
            </h2>
            <p className={styles.meta}>
              {t.settingsUpdate.currentVersion} {currentVersion || t.settingsUpdate.unknownVersion}
              {availableVersion ? ` · v${availableVersion}` : ''}
            </p>
          </div>
          <span className={`${styles.badge} ${badgeClass}`}>
            {status === 'error'
              ? t.settingsBuiltin.statusError
              : status === 'downloading' || status === 'installing'
                ? t.status.processing
                : t.settingsBuiltin.statusActive}
          </span>
        </header>

        <div className={styles.body}>
          <p className={styles.desc}>{desc}</p>

          <div className={`${styles.progress} ${showProgress ? styles.progressVisible : ''}`}>
            <div className={styles.progressMeta}>
              <span>{t.settingsUpdate.downloading.replace('{percent}', String(progress.percent))}</span>
              <span>{progress.detail}</span>
            </div>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${progress.percent}%` }} />
            </div>
          </div>

          {showNotes ? (
            <div className={styles.notes}>
              <p className={styles.notesLabel}>{t.settingsUpdate.notes}</p>
              <p className={styles.notesBody}>{notes}</p>
            </div>
          ) : null}

          {status === 'error' ? <div className={styles.error}>{error || t.settingsUpdate.downloadFailed}</div> : null}
        </div>

        <footer className={styles.footer}>
          <div className={styles.leftActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDismiss}
              disabled={!canDismiss}
            >
              {t.settingsUpdate.modalRemindLater}
            </button>
          </div>
          <div className={styles.rightActions}>
            {status === 'available' ? (
              <button type="button" className={styles.secondaryButton} onClick={handleIgnoreVersion}>
                {t.settingsUpdate.modalIgnoreVersion}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                void handlePrimaryAction();
              }}
              disabled={status === 'downloading' || status === 'installing'}
            >
              {status === 'available'
                ? t.settingsUpdate.downloadAndInstall
                : status === 'error'
                  ? t.actions.retry
                  : status === 'restartRequired'
                    ? t.settingsUpdate.modalRestartNow
                    : t.settingsUpdate.installing}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
