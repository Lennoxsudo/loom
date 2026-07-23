import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import { showSuccess as globalShowSuccess } from '../../utils/notification';
import { type ImageGenerationConfig, type ImageGenerationQuality } from './types';
import { filterImageModels } from '../../utils/imageGenConfig';
import listStyles from './SettingsExpandableList.module.css';
import styles from './ImageGenerationSection.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsToggle,
} from './SettingsPrimitives';

export function ImageGenerationSection({
  config,
  onChange,
  onSave,
  isSaving = false,
  embeddedInTab = false,
}: {
  config: ImageGenerationConfig;
  onChange: (patch: Partial<ImageGenerationConfig>) => void;
  onSave?: () => void;
  isSaving?: boolean;
  embeddedInTab?: boolean;
}) {
  const t = useTranslation();
  const ig = t.settingsAiConfig.imageGeneration;
  const form = t.settingsAiConfig.form;
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetch, setModelFetch] = useState<{ models: string[]; error?: string } | undefined>();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const models = config.models.length > 0 ? config.models : [''];

  const qualityOptions = [
    { value: 'standard' as const, label: ig.qualityStandard },
    { value: 'hd' as const, label: ig.qualityHd },
  ];

  const handleAddModel = () => {
    if (models.length < 10) {
      onChange({ models: [...models, ''] });
    }
  };

  const handleRemoveModel = (index: number) => {
    if (models.length > 1) {
      onChange({ models: models.filter((_, i) => i !== index) });
    }
  };

  const handleModelChange = (index: number, value: string) => {
    const next = [...models];
    next[index] = value;
    onChange({ models: next });
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    try {
      if (!config.endpoint.trim() || !config.apiKey.trim()) {
        setModelFetch({
          models: [],
          error: t.settingsAiConfig.errors.incompleteConfig,
        });
        return;
      }

      const result = await invoke<{ success: boolean; message: string; models: string[] }>(
        'list_ai_models',
        {
          provider: 'openai',
          config: {
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            organizationId: config.organizationId,
          },
        }
      );

      if (!result.success) {
        setModelFetch({
          models: [],
          error: result.message || t.errors.loadModelListFailed,
        });
        return;
      }

      const imageModels = filterImageModels(result.models);
      setModelFetch({
        models: imageModels,
        error: imageModels.length === 0 ? ig.fetchedModelsEmpty : undefined,
      });
    } catch (error) {
      setModelFetch({
        models: [],
        error: `${t.errors.loadModelListFailed}: ${String(error)}`,
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleCopyModel = async (model: string) => {
    try {
      await navigator.clipboard.writeText(model);
      globalShowSuccess(form.modelCopied);
    } catch {
      // ignore clipboard errors
    }
  };

  const resolveTestModel = () => {
    const first = models.map((model) => model.trim()).find(Boolean);
    return first || config.defaultModel?.trim() || '';
  };

  const handleTestGeneration = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const model = resolveTestModel();
      if (!config.endpoint.trim() || !config.apiKey.trim() || !model) {
        setTestResult({
          success: false,
          message: t.settingsAiConfig.errors.incompleteConfig,
        });
        return;
      }

      const result = await invoke<{ success: boolean; message: string }>('test_image_generation', {
        config: {
          endpoint: config.endpoint,
          apiKey: config.apiKey,
          model,
          organizationId: config.organizationId,
          quality: config.defaultQuality,
        },
      });

      setTestResult({
        success: result.success,
        message: result.success ? ig.testSuccess : result.message,
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: t.settingsAiConfig.errors.testFailed.replace('{error}', String(error)),
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className={embeddedInTab ? styles.imageGenTabContent : styles.imageGenPanel}>
      <SettingsPanel>
        <SettingsSection
          title={embeddedInTab ? ig.tabLabel : ig.title}
          description={ig.hint}
          action={
            onSave ? (
              <button type="button" className={styles.saveBtn} onClick={onSave} disabled={isSaving}>
                {isSaving ? form.saving : form.saveConfig}
              </button>
            ) : null
          }
        >
          <SettingsRow
            label={ig.enabled}
            hint={ig.enabledHint}
            control={
              <SettingsToggle
                checked={config.enabled}
                onChange={(checked) => onChange({ enabled: checked })}
                ariaLabel={ig.enabled}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={ig.connectionTitle}>
          <SettingsBlockBody>
            <div className={listStyles.formBlock}>
              <div className={listStyles.formField}>
                <label className={listStyles.formLabel}>{form.endpoint}</label>
                <input
                  type="text"
                  className={listStyles.formInput}
                  value={config.endpoint}
                  onChange={(e) => onChange({ endpoint: e.target.value })}
                  placeholder={form.endpointPlaceholder}
                />
              </div>
              <div className={listStyles.formField}>
                <label className={listStyles.formLabel}>{form.apiKey}</label>
                <input
                  type="password"
                  className={listStyles.formInput}
                  value={config.apiKey}
                  onChange={(e) => onChange({ apiKey: e.target.value })}
                  placeholder={form.apiKeyPlaceholder}
                />
              </div>
              <div className={listStyles.formField}>
                <label className={listStyles.formLabel}>{form.organizationId}</label>
                <input
                  type="text"
                  className={listStyles.formInput}
                  value={config.organizationId || ''}
                  onChange={(e) => onChange({ organizationId: e.target.value })}
                  placeholder={form.organizationIdPlaceholder}
                />
              </div>
            </div>
          </SettingsBlockBody>
        </SettingsSection>

        <SettingsSection
          title={ig.modelName}
          action={
            <button
              type="button"
              className={styles.fetchBtn}
              onClick={() => void handleFetchModels()}
              disabled={fetchingModels}
            >
              {fetchingModels ? form.fetchingModels : form.fetchModels}
            </button>
          }
        >
          <SettingsBlockBody>
            {models.map((model, index) => (
              <div key={index} className={styles.modelRow}>
                <input
                  type="text"
                  className={listStyles.formInput}
                  value={model}
                  onChange={(e) => handleModelChange(index, e.target.value)}
                  placeholder={form.modelPlaceholder.replace('{index}', String(index + 1))}
                />
                {index === 0 && models.length < 10 && (
                  <button type="button" className={styles.iconBtn} onClick={handleAddModel}>
                    +
                  </button>
                )}
                {index > 0 && (
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => handleRemoveModel(index)}
                  >
                    −
                  </button>
                )}
              </div>
            ))}

            {modelFetch && (
              <div style={{ marginTop: 8 }}>
                {modelFetch.error && !modelFetch.models.length ? (
                  <div className={styles.errorText}>{modelFetch.error}</div>
                ) : modelFetch.models.length > 0 ? (
                  <>
                    <p className={styles.fetchedHint}>{form.fetchedModelsTitle}</p>
                    <div className={styles.fetchedList}>
                      {modelFetch.models.map((model) => (
                        <button
                          key={model}
                          type="button"
                          className={styles.fetchedItem}
                          onClick={() => void handleCopyModel(model)}
                          title={model}
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </SettingsBlockBody>
        </SettingsSection>

        <SettingsSection title={ig.defaultsTitle}>
          <SettingsRow
            label={ig.defaultQuality}
            control={
              <SettingsSegmented<ImageGenerationQuality>
                value={config.defaultQuality || 'standard'}
                options={qualityOptions}
                onChange={(quality) => onChange({ defaultQuality: quality })}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={ig.testTitle} description={ig.testHint}>
          <SettingsBlockBody>
            <div className={styles.testRow}>
              <button
                type="button"
                className={styles.testBtn}
                onClick={() => void handleTestGeneration()}
                disabled={isTesting}
              >
                {isTesting ? ig.testingGeneration : ig.testGeneration}
              </button>
              {testResult ? (
                <p
                  className={testResult.success ? styles.testResultSuccess : styles.testResultError}
                >
                  {testResult.message}
                </p>
              ) : null}
            </div>
          </SettingsBlockBody>
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
