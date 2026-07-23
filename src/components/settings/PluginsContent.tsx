import { useState } from 'react';
import { useTranslation } from '../../i18n';
import { useEnableCdpBrowser, useUpdateEnableCdpBrowser } from '../../stores';
import { useNotification } from '../../contexts/NotificationContext';
import pageStyles from './SettingsPage.module.css';
import styles from './PluginsContent.module.css';
import { SettingsPanel, SettingsRow, SettingsSection, SettingsToggle } from './SettingsPrimitives';

export function PluginsContent() {
  const t = useTranslation();
  const { showError } = useNotification();
  const enableCdpBrowser = useEnableCdpBrowser();
  const updateEnableCdpBrowser = useUpdateEnableCdpBrowser();
  const [isSaving, setIsSaving] = useState(false);

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsPlugins.title}</h2>
      </header>

      <SettingsPanel>
        <SettingsSection title={t.settingsPlugins.installed}>
          <SettingsRow
            label={
              <span className={styles.labelWithBadge}>
                <span>{t.settingsPlugins.cdpBrowserToggle}</span>
                <span className={styles.builtinBadge}>{t.settingsPlugins.builtin}</span>
              </span>
            }
            control={
              <SettingsToggle
                checked={enableCdpBrowser}
                disabled={isSaving}
                ariaLabel={t.settingsPlugins.cdpBrowserToggle}
                onChange={(checked) => {
                  setIsSaving(true);
                  void updateEnableCdpBrowser(checked)
                    .catch(() => showError(t.errors.updateFailed))
                    .finally(() => setIsSaving(false));
                }}
              />
            }
          />
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
