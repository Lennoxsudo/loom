import { useState } from 'react';
import { useLanguage, useUpdateLanguage } from '../../stores';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import pageStyles from './SettingsPage.module.css';
import {
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from './SettingsPrimitives';

export function PreferencesContent() {
  const t = useTranslation();
  const language = useLanguage();
  const updateLanguage = useUpdateLanguage();
  const { showError } = useNotification();
  const [isSaving, setIsSaving] = useState(false);

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsTabs.preferences}</h2>
      </header>

      <SettingsPanel>
        <SettingsSection title={t.settingsGeneral.language.title}>
          <SettingsRow
            label={t.settingsGeneral.language.title}
            hint={
              isSaving
                ? t.common.saving
                : `${language === 'zh-CN' ? t.settingsGeneral.language.chinese : t.settingsGeneral.language.english}（${t.settingsGeneral.language.restartHint}）`
            }
            control={
              <SettingsSegmented
                value={language}
                disabled={isSaving}
                options={[
                  { value: 'zh-CN' as const, label: t.settingsGeneral.language.chinese },
                  { value: 'en-US' as const, label: t.settingsGeneral.language.english },
                ]}
                onChange={async (value) => {
                  setIsSaving(true);
                  try {
                    await updateLanguage(value);
                  } catch {
                    showError(t.errors.updateFailed);
                  } finally {
                    setIsSaving(false);
                  }
                }}
              />
            }
          />
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
