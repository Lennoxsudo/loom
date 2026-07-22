import {
  useAppUpdateState,
  useAppUpdateStore,
  useCheckForUpdatesOnStartup,
  useUpdateCheckForUpdatesOnStartup,
} from '../../stores';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import {
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from './SettingsPrimitives';
import localStyles from './GeneralContent.module.css';

function formatProgress(downloaded: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

export default function UpdateSettingsSection() {
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

  const statusText = (() => {
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
        return '';
    }
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

  return (
    <SettingsSection title={t.settingsUpdate.title} description={t.settingsUpdate.description}>
      <SettingsRow
        label={t.settingsUpdate.currentVersion}
        hint={currentVersion || t.settingsUpdate.unknownVersion}
      />
      <SettingsRow
        label={t.settingsUpdate.checkForUpdates}
        hint={statusText || undefined}
        control={
          <button
            type="button"
            className={localStyles.primaryButton}
            disabled={busy || status === 'desktopOnly'}
            onClick={() => {
              void onCheck();
            }}
          >
            {status === 'checking' ? t.settingsUpdate.checking : t.settingsUpdate.checkForUpdates}
          </button>
        }
      />
      {status === 'available' || status === 'downloading' || status === 'installing' ? (
        <SettingsRow
          label={t.settingsUpdate.downloadAndInstall}
          hint={
            notes
              ? `${t.settingsUpdate.notes}: ${notes.slice(0, 200)}${notes.length > 200 ? '…' : ''}`
              : statusText || undefined
          }
          control={
            <button
              type="button"
              className={localStyles.primaryButton}
              disabled={busy}
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
          }
        />
      ) : null}
      <SettingsRow
        label={t.settingsUpdate.checkOnStartup}
        hint={t.settingsUpdate.checkOnStartupHint}
        control={
          <SettingsToggle
            checked={checkOnStartup}
            ariaLabel={t.settingsUpdate.checkOnStartup}
            onChange={(enabled) => {
              void updateCheckOnStartup(enabled).catch(() => {
                showError(t.errors.updateFailed);
              });
            }}
          />
        }
      />
    </SettingsSection>
  );
}
