import { useTranslation } from '../../i18n';
import pageStyles from './SettingsPage.module.css';
import {
  SettingsPanel,
  SettingsSection,
} from './SettingsPrimitives';

export function PluginsContent() {
  const t = useTranslation();

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsPlugins.title}</h2>
        <p className={pageStyles.pageDescription}>{t.settingsPlugins.description}</p>
      </header>

      <SettingsPanel>
        <SettingsSection title={t.settingsPlugins.installed}>
          <p className={pageStyles.pageDescription}>{t.settingsPlugins.comingSoon}</p>
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
