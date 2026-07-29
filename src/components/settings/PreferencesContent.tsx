import { useState } from 'react';
import {
  useLanguage,
  useUpdateLanguage,
  useUpdateVoiceInputLanguage,
  useVoiceInputLanguage,
} from '../../stores';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import type { VoiceInputLanguage } from '../../types/settings';
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
  const voiceInputLanguage = useVoiceInputLanguage();
  const updateVoiceInputLanguage = useUpdateVoiceInputLanguage();
  const { showError } = useNotification();
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);

  const voiceHint = t.settingsGeneral.voiceInputLanguage.description;

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
          <SettingsRow
            label={t.settingsGeneral.voiceInputLanguage.title}
            hint={isSavingVoice ? t.common.saving : voiceHint}
            control={
              <SettingsSegmented
                value={voiceInputLanguage}
                disabled={isSavingVoice}
                options={[
                  {
                    value: 'auto' as VoiceInputLanguage,
                    label: t.settingsGeneral.voiceInputLanguage.auto,
                  },
                  {
                    value: 'zh' as VoiceInputLanguage,
                    label: t.settingsGeneral.voiceInputLanguage.chinese,
                  },
                  {
                    value: 'en' as VoiceInputLanguage,
                    label: t.settingsGeneral.voiceInputLanguage.english,
                  },
                ]}
                onChange={async (value) => {
                  setIsSavingVoice(true);
                  try {
                    await updateVoiceInputLanguage(value);
                  } catch {
                    showError(t.errors.updateFailed);
                  } finally {
                    setIsSavingVoice(false);
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
