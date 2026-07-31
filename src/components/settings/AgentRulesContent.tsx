import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  useLoadRules,
  useRulesLoaded,
  useRulesTemplates,
} from '../../stores/useRulesStore';
import {
  showError as globalShowError,
  showSuccess as globalShowSuccess,
} from '../../utils/notification';
import pageStyles from './SettingsPage.module.css';
import { SettingsSelect } from './SettingsPrimitives';
import styles from './RulesContent.module.css';

export type AgentRulesContentProps = {
  rules: string;
  onSave: (rules: string) => Promise<void>;
  unavailable?: boolean;
};

export function AgentRulesContent({
  rules,
  onSave,
  unavailable = false,
}: AgentRulesContentProps) {
  const t = useTranslation();
  const templates = useRulesTemplates();
  const loaded = useRulesLoaded();
  const loadRules = useLoadRules();
  const [draft, setDraft] = useState(rules);
  const [templateId, setTemplateId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) {
      void loadRules();
    }
  }, [loaded, loadRules]);

  useEffect(() => {
    setDraft(rules);
    setTemplateId('');
  }, [rules]);

  const dirty = draft !== rules;

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const template = templates.find((item) => item.id === id);
    if (template) {
      setDraft(template.content);
    }
  };

  const handleSave = async () => {
    if (unavailable) return;
    setSaving(true);
    try {
      await onSave(draft);
      globalShowSuccess(t.settingsAgent.rules.saved);
    } catch (e) {
      globalShowError(`${t.settingsAgent.rules.saveFailed}: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setDraft('');
    setTemplateId('');
  };

  if (unavailable) {
    return <div className={pageStyles.loading}>{t.settingsAgent.rules.unavailable}</div>;
  }

  const templateOptions = [
    { value: '', label: t.settingsAgent.rules.noTemplate },
    ...templates.map((item) => ({ value: item.id, label: item.name })),
  ];

  return (
    <div className={styles.root}>
      <p className={pageStyles.pageDescription} style={{ marginBottom: 16 }}>
        {t.settingsAgent.rules.description}
      </p>

      <div className={styles.formBlock} style={{ margin: 0 }}>
        <div className={styles.editorPanel}>
          <div className={styles.formField}>
            <label className={styles.formLabel}>{t.settingsAgent.rules.applyTemplate}</label>
            <SettingsSelect
              value={templateId}
              options={templateOptions}
              onChange={handleTemplateChange}
              placeholder={t.settingsAgent.rules.noTemplate}
            />
          </div>
          <div className={`${styles.formField} ${styles.formFieldLast}`}>
            <label className={styles.formLabel}>{t.settingsAgent.rules.content}</label>
            <textarea
              className={`${styles.formTextarea} ${styles.formTextareaMono}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.settingsAgent.rules.placeholder}
              spellCheck={false}
            />
          </div>
          <div className={styles.formFooter}>
            <div className={styles.formFooterActions}>
              <button type="button" className={styles.cancelBtn} onClick={handleClear}>
                {t.settingsAgent.rules.clear}
              </button>
              <button
                type="button"
                className={styles.saveBtn}
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
              >
                {saving ? t.settingsAgent.rules.saving : t.settingsAgent.rules.save}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
