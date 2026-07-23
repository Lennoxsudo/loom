import {
  useAppUpdateState,
  useAppUpdateStore,
  useCheckForUpdatesOnStartup,
  useUpdateCheckForUpdatesOnStartup,
} from '../../stores';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import { SettingsToggle } from './SettingsPrimitives';
import pageStyles from './SettingsPage.module.css';
import styles from './UpdateContent.module.css';

function formatProgress(downloaded: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

type StageTone = 'idle' | 'upToDate' | 'available' | 'busy' | 'error' | 'desktopOnly';

function resolveTone(status: string): StageTone {
  switch (status) {
    case 'upToDate':
      return 'upToDate';
    case 'available':
    case 'restartRequired':
      return 'available';
    case 'checking':
    case 'downloading':
    case 'installing':
      return 'busy';
    case 'error':
      return 'error';
    case 'desktopOnly':
      return 'desktopOnly';
    default:
      return 'idle';
  }
}

const toneClass: Record<StageTone, string> = {
  idle: styles.stageToneIdle,
  upToDate: styles.stageToneUpToDate,
  available: styles.stageToneAvailable,
  busy: styles.stageToneBusy,
  error: styles.stageToneError,
  desktopOnly: styles.stageToneDesktopOnly,
};

export function UpdateContent() {
  const t = useTranslation();
  const { showError, showSuccess, showInfo } = useNotification();
  const checkOnStartup = useCheckForUpdatesOnStartup();
  const updateCheckOnStartup = useUpdateCheckForUpdatesOnStartup();
  const {
    currentVersion,
    status,
    availableVersion,
    notes,
    downloadedBytes,
    contentLength,
    error,
    checkForUpdates,
    downloadAndInstall,
  } = useAppUpdateState();

  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const percent = formatProgress(downloadedBytes, contentLength);
  const tone = resolveTone(status);
  const versionLabel = currentVersion || t.settingsUpdate.unknownVersion;

  const statusHeadline = (() => {
    switch (status) {
      case 'checking':
        return t.settingsUpdate.checking;
      case 'upToDate':
        return t.settingsUpdate.upToDate;
      case 'available':
        return t.settingsUpdate.available.replace('{version}', availableVersion ?? '');
      case 'downloading':
        return t.settingsUpdate.downloading.replace('{percent}', String(percent));
      case 'installing':
        return t.settingsUpdate.installing;
      case 'restartRequired':
        return t.settingsUpdate.restartRequired;
      case 'desktopOnly':
        return t.settingsUpdate.desktopOnly;
      case 'error':
        return error || t.settingsUpdate.checkFailed;
      default:
        return t.settingsUpdate.checkForUpdates;
    }
  })();

  const statusDetail = (() => {
    if (status === 'error') return error || t.settingsUpdate.checkFailed;
    if (status === 'available' && availableVersion) {
      return t.settingsUpdate.available.replace('{version}', availableVersion);
    }
    if (status === 'idle') return t.settingsUpdate.description;
    if (status === 'upToDate') return t.settingsUpdate.description;
    if (status === 'desktopOnly') return t.settingsUpdate.desktopOnly;
    if (status === 'restartRequired') return t.settingsUpdate.restartRequired;
    return statusHeadline;
  })();

  const onCheck = async () => {
    await checkForUpdates();
    const state = useAppUpdateStore.getState();
    if (state.status === 'error') {
      showError(state.error || t.settingsUpdate.checkFailed);
    } else if (state.status === 'upToDate') {
      showSuccess(t.settingsUpdate.upToDate);
    } else if (state.status === 'available') {
      showInfo(t.settingsUpdate.available.replace('{version}', state.availableVersion ?? ''));
    } else if (state.status === 'desktopOnly') {
      showInfo(t.settingsUpdate.desktopOnly);
    }
  };

  const onInstall = async () => {
    await downloadAndInstall();
    const state = useAppUpdateStore.getState();
    if (state.status === 'error') {
      showError(state.error || t.settingsUpdate.downloadFailed);
    }
  };

  const showInstall = status === 'available' || status === 'downloading' || status === 'installing';
  const showProgress = status === 'downloading';

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsTabs.update}</h2>
        <p className={pageStyles.pageDescription}>{t.settingsUpdate.description}</p>
      </header>

      <section className={`${styles.stage} ${toneClass[tone]}`} aria-live="polite">
        <div className={styles.versionPane}>
          <p className={styles.versionEyebrow}>{t.settingsUpdate.currentVersion}</p>
          <p className={styles.versionNumber} title={versionLabel}>
            {versionLabel}
          </p>
          <p className={styles.versionMeta}>{t.settingsUpdate.title}</p>
        </div>

        <div className={styles.statusPane}>
          <div className={styles.statusTop}>
            <span className={styles.statusBadge}>
              <span className={styles.statusDot} aria-hidden />
              {statusHeadline}
            </span>
            <p
              className={`${styles.statusDetail} ${
                status === 'error' ? styles.statusDetailError : ''
              }`}
            >
              {statusDetail}
            </p>
            {showProgress ? (
              <div className={styles.progressBlock}>
                <div className={styles.progressTrack} aria-hidden>
                  <div className={styles.progressFill} style={{ width: `${percent}%` }} />
                </div>
                <span className={styles.progressLabel}>{percent}%</span>
              </div>
            ) : null}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || status === 'desktopOnly'}
              onClick={() => {
                void onCheck();
              }}
            >
              {status === 'checking' ? t.settingsUpdate.checking : t.settingsUpdate.checkForUpdates}
            </button>
            {showInstall ? (
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={status === 'downloading' || status === 'installing'}
                onClick={() => {
                  void onInstall();
                }}
              >
                {status === 'downloading'
                  ? t.settingsUpdate.downloading.replace('{percent}', String(percent))
                  : status === 'installing'
                    ? t.settingsUpdate.installing
                    : t.settingsUpdate.downloadAndInstall}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {notes && (status === 'available' || status === 'downloading' || status === 'installing') ? (
        <section className={styles.notes}>
          <p className={styles.notesLabel}>{t.settingsUpdate.notes}</p>
          <p className={styles.notesBody}>{notes}</p>
        </section>
      ) : null}

      <div className={styles.prefRow}>
        <div className={styles.prefCopy}>
          <p className={styles.prefLabel}>{t.settingsUpdate.checkOnStartup}</p>
          <p className={styles.prefHint}>{t.settingsUpdate.checkOnStartupHint}</p>
        </div>
        <SettingsToggle
          checked={checkOnStartup}
          ariaLabel={t.settingsUpdate.checkOnStartup}
          onChange={(enabled) => {
            void updateCheckOnStartup(enabled).catch(() => {
              showError(t.errors.updateFailed);
            });
          }}
        />
      </div>
    </div>
  );
}
