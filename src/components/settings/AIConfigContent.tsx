import { useState, useEffect, useRef, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from '../../i18n';
import { showSuccess as globalShowSuccess } from '../../utils/notification';
import { type AIProvider, type AIConfigTab, type AIConfig, type AIProfileItem, type AIProviderProfiles, type AIProfiles, type ImageGenerationConfig, DEFAULT_AI_CONFIGS, DEFAULT_IMAGE_GENERATION_CONFIG } from './types';
import { normalizeImageGenerationConfig } from '../../utils/imageGenConfig';
import { ImageGenerationSection } from './ImageGenerationSection';
import { ChevronDownIcon, CloseIcon, EditIcon, PlusIcon } from '../shared/Icons';
import styles from './AIConfigContent.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';

function ConfigTabSelector({
  activeTab,
  imageGenTabLabel,
  onSelectTab,
}: {
  activeTab: AIConfigTab;
  imageGenTabLabel: string;
  onSelectTab: (tab: AIConfigTab) => void;
}) {
  return (
    <div className={styles.tabBar}>
      <ProviderCard
        label="OpenAI"
        isSelected={activeTab === 'openai'}
        onClick={() => onSelectTab('openai')}
      />
      <ProviderCard
        label="Anthropic"
        isSelected={activeTab === 'anthropic'}
        onClick={() => onSelectTab('anthropic')}
      />
      <ProviderCard
        label="Gemini"
        isSelected={activeTab === 'gemini'}
        onClick={() => onSelectTab('gemini')}
      />
      <ProviderCard
        label="Ollama"
        isSelected={activeTab === 'ollama'}
        onClick={() => onSelectTab('ollama')}
      />
      <ProviderCard
        label={imageGenTabLabel}
        isSelected={activeTab === 'image-generation'}
        onClick={() => onSelectTab('image-generation')}
      />
    </div>
  );
}

function ProviderCard({
  label,
  isSelected,
  onClick,
}: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.tabButton} ${isSelected ? styles.tabButtonActive : ''}`}
    >
      {label}
    </button>
  );
}

function ProfileCard({
  title,
  subtitle,
  badge,
  isActive,
  isExpanded,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onToggle,
  onEdit,
  onEnable,
  onDelete,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  isActive?: boolean;
  isExpanded?: boolean;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
  onToggle: () => void;
  onEdit?: () => void;
  onEnable?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const renameAreaRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    if (!isRenaming) return;

    const handlePointerDown = (event: MouseEvent) => {
      const node = renameAreaRef.current;
      if (node && !node.contains(event.target as Node)) {
        onRenameCancel?.();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isRenaming, onRenameCancel]);

  useEffect(() => {
    if (!contentRef.current) return;

    if (isExpanded) {
      setHeight(contentRef.current.scrollHeight);

      const observer = new ResizeObserver(() => {
        if (contentRef.current) {
          setHeight(contentRef.current.scrollHeight);
        }
      });

      observer.observe(contentRef.current);

      return () => observer.disconnect();
    }

    setHeight(0);
  }, [isExpanded]);

  return (
    <div
      className={`${styles.profileCard} ${isActive ? styles.profileCardActive : ''}`}
    >
      <div
        ref={renameAreaRef}
        role="button"
        tabIndex={0}
        onClick={isRenaming ? undefined : onToggle}
        onKeyDown={(event) => {
          if (!isRenaming && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onToggle();
          }
        }}
        className={`${styles.profileHeader} ${isRenaming ? styles.profileHeaderRenaming : ''}`}
      >
        <div className={styles.profileMain}>
          <div className={styles.profileTitleRow}>
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange?.(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    onRenameSubmit?.();
                  } else if (e.key === 'Escape') {
                    onRenameCancel?.();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className={styles.renameInput}
              />
            ) : (
              <div className={styles.profileTitle}>{title}</div>
            )}
            {!isRenaming && badge ? <span className={styles.activeBadge}>{badge}</span> : null}
          </div>
          {!isRenaming && subtitle ? <div className={styles.profileSubtitle}>{subtitle}</div> : null}
        </div>

        <div className={styles.profileActions}>
          {isRenaming ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRenameSubmit?.();
                }}
                className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
              >
                {t.actions.save}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRenameCancel?.();
                }}
                className={styles.actionBtn}
              >
                {t.actions.cancel}
              </button>
            </>
          ) : (
            <>
              {onEdit ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className={styles.actionBtn}
                  title={t.actions.edit}
                >
                  <EditIcon size={12} />
                </button>
              ) : null}
              {onEnable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnable();
                  }}
                  className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                >
                  {t.common.enable}
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  title={t.actions.delete}
                >
                  <CloseIcon size={12} />
                </button>
              ) : null}
              <span className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}>
                <ChevronDownIcon size={12} />
              </span>
            </>
          )}
        </div>
      </div>

      <div className={styles.profileBodyWrap} style={{ height: `${height}px` }}>
        <div ref={contentRef} className={styles.profileBody}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ConfigForm({
  provider,
  config,
  onConfigChange,
  onSave,
  onTest,
  onFetchModels,
  isSaving,
  isTesting,
  isFetchingModels,
  testResult,
  modelFetch,
  onCopyModel,
  onAddModel,
  onRemoveModel,
  onModelChange,
}: {
  provider: AIProvider;
  config: Partial<AIConfig>;
  onConfigChange: (field: keyof AIConfig, value: string | string[]) => void;
  onSave: () => void;
  onTest: () => void;
  onFetchModels: () => void;
  isSaving: boolean;
  isTesting: boolean;
  isFetchingModels: boolean;
  testResult: { success: boolean; message: string } | null;
  modelFetch: { models: string[]; error?: string } | undefined;
  onCopyModel: (model: string) => void;
  onAddModel: () => void;
  onRemoveModel: (index: number) => void;
  onModelChange: (index: number, value: string) => void;
}) {
  const t = useTranslation();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = (field: keyof AIConfig, value: string) => {
    const newErrors = { ...errors };

    if (field === 'apiKey' && !value.trim() && provider !== 'ollama') {
      newErrors[field] = t.settingsAiConfig.errors.apiKeyRequired;
    } else if (field === 'endpoint' && !value.trim()) {
      newErrors[field] = t.settingsAiConfig.errors.endpointRequired;
    } else {
      delete newErrors[field];
    }

    setErrors(newErrors);
  };

  const handleChange = (field: keyof AIConfig, value: string) => {
    onConfigChange(field, value);
    validateField(field, value);
  };

  const models = config.models || [''];

  return (
    <div className={styles.configForm}>
      <FormField
        label={t.settingsAiConfig.form.endpoint}
        value={config.endpoint || ''}
        onChange={(value) => handleChange('endpoint', value)}
        placeholder={t.settingsAiConfig.form.endpointPlaceholder}
        required
        error={errors.endpoint}
      />

      <FormField
        label={t.settingsAiConfig.form.apiKey}
        value={config.apiKey || ''}
        onChange={(value) => handleChange('apiKey', value)}
        placeholder={provider === 'ollama' ? t.settingsAiConfig.form.apiKeyPlaceholderOllama : t.settingsAiConfig.form.apiKeyPlaceholder}
        type="password"
        required={provider !== 'ollama'}
        error={errors.apiKey}
      />

      <div className={styles.modelSection}>
        <div className={styles.modelHeader}>
          <label className={styles.formLabel}>
            {t.settingsAiConfig.form.modelName}
            <span className={styles.formLabelRequired}>*</span>
            <span className={styles.modelHint}>{t.settingsAiConfig.form.modelLimit}</span>
          </label>
          <button
            type="button"
            onClick={onFetchModels}
            disabled={isFetchingModels}
            className={styles.fetchModelsBtn}
          >
            {isFetchingModels
              ? t.settingsAiConfig.form.fetchingModels
              : t.settingsAiConfig.form.fetchModels}
          </button>
        </div>
        {models.map((model, index) => (
          <div key={index} className={styles.modelRow}>
            <input
              type="text"
              value={model}
              onChange={(e) => onModelChange(index, e.target.value)}
              placeholder={t.settingsAiConfig.form.modelPlaceholder.replace('{index}', String(index + 1))}
              className={`${styles.formInput} ${styles.modelInput} ${!model.trim() && index === 0 ? styles.formInputError : ''}`}
            />
            <div style={{ display: 'flex', gap: '4px' }}>
              {index === 0 && models.length < 10 && (
                <button
                  type="button"
                  onClick={onAddModel}
                  className={`${styles.modelBtn} ${styles.modelBtnAdd}`}
                  title={t.settingsAiConfig.form.addModel}
                >
                  +
                </button>
              )}
              {index > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onRemoveModel(index)}
                    className={`${styles.modelBtn} ${styles.modelBtnRemove}`}
                    title={t.settingsAiConfig.form.removeModel}
                  >
                    −
                  </button>
                  {index === models.length - 1 && models.length < 10 && (
                    <button
                      type="button"
                      onClick={onAddModel}
                      className={`${styles.modelBtn} ${styles.modelBtnAdd}`}
                      title={t.settingsAiConfig.form.addModel}
                    >
                      +
                    </button>
                  )}
                </>
              )}
              {index === 0 && models.length >= 10 && <div style={{ width: '30px', flexShrink: 0 }} />}
            </div>
          </div>
        ))}
        {!models[0]?.trim() && (
          <div className={styles.formError}>{t.settingsAiConfig.form.modelRequiredError}</div>
        )}
        {modelFetch && (
          <div style={{ marginTop: '10px' }}>
            {modelFetch.error ? (
              <div className={styles.formError}>{modelFetch.error}</div>
            ) : modelFetch.models.length > 0 ? (
              <>
                <div className={styles.modelHint} style={{ marginBottom: '6px' }}>
                  {t.settingsAiConfig.form.fetchedModelsTitle}
                </div>
                <div className={styles.modelList}>
                  {modelFetch.models.map((model) => (
                    <button
                      key={model}
                      type="button"
                      onClick={() => onCopyModel(model)}
                      title={model}
                      className={styles.modelListItem}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.modelHint}>{t.settingsAiConfig.form.fetchedModelsEmpty}</div>
            )}
          </div>
        )}
      </div>

      {provider === 'openai' && (
        <FormField
          label={t.settingsAiConfig.form.organizationId}
          value={config.organizationId || ''}
          onChange={(value) => handleChange('organizationId', value)}
          placeholder={t.settingsAiConfig.form.organizationIdPlaceholder}
        />
      )}

      {provider === 'ollama' && (
        <div className={styles.ollamaHint}>
          <div className={styles.ollamaHintTitle}>{t.settingsAiConfig.ollama.title}</div>
          <div>• {t.settingsAiConfig.ollama.hint2}</div>
          <div>• {t.settingsAiConfig.ollama.hint3}</div>
          <div>• {t.settingsAiConfig.ollama.hint5}</div>
          <div>
            • <strong>{t.settingsAiConfig.ollama.hint6}</strong>
          </div>
          <div>• {t.settingsAiConfig.ollama.hint7}</div>
          <div>
            • {t.settingsAiConfig.ollama.installHint}{' '}
            <a
              href="https://ollama.ai"
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await openUrl('https://ollama.ai');
                } catch (err) {
                  console.error('Failed to open URL:', err);
                }
              }}
              className={styles.ollamaLink}
            >
              ollama.ai
            </a>{' '}
            {t.settingsAiConfig.ollama.downloadAndRun}{' '}
            <code className={styles.ollamaCode}>ollama pull llama3.1</code>
          </div>
        </div>
      )}

      <div className={styles.formFooter}>
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className={styles.secondaryBtn}
        >
          {isTesting ? t.settingsAiConfig.form.testing : t.settingsAiConfig.form.testConnection}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className={styles.primaryBtn}
        >
          {isSaving ? t.settingsAiConfig.form.saving : t.settingsAiConfig.form.saveConfig}
        </button>

        {testResult && (
          <div
            className={`${styles.testResult} ${testResult.success ? styles.testResultSuccess : styles.testResultError}`}
          >
            <span>{testResult.success ? '✓' : '✗'}</span>
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  required?: boolean;
  error?: string;
}) {
  return (
    <div className={styles.formField}>
      <label className={styles.formLabel}>
        {label}
        {required ? <span className={styles.formLabelRequired}>*</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${styles.formInput} ${error ? styles.formInputError : ''}`}
      />
      {error ? <div className={styles.formError}>{error}</div> : null}
    </div>
  );
}

export function AIConfigContent() {
  const t = useTranslation();
  const createDefaultProfiles = (): AIProfiles => ({
    openai: {
      activeId: 'default-openai',
              items: [{ id: 'default-openai', name: t.common.defaultConfig, ...DEFAULT_AI_CONFIGS.openai }],    },
    anthropic: {
      activeId: 'default-anthropic',
              items: [{ id: 'default-anthropic', name: t.common.defaultConfig, ...DEFAULT_AI_CONFIGS.anthropic }],    },
    gemini: {
      activeId: 'default-gemini',
              items: [{ id: 'default-gemini', name: t.common.defaultConfig, ...DEFAULT_AI_CONFIGS.gemini }],    },
    ollama: {
      activeId: 'default-ollama',
              items: [{ id: 'default-ollama', name: t.common.defaultConfig, ...DEFAULT_AI_CONFIGS.ollama }],    },
  });

  const normalizeConfigValue = (provider: AIProvider, value: unknown): Partial<AIConfig> => {
    const fallback = DEFAULT_AI_CONFIGS[provider];
    const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

    const endpoint = typeof obj.endpoint === 'string' ? obj.endpoint : fallback.endpoint;
    const apiKey = typeof obj.apiKey === 'string' ? obj.apiKey : fallback.apiKey;

    let models: string[];
    if (Array.isArray(obj.models)) {
      models = obj.models.map((m: unknown) => (typeof m === 'string' ? m : '')).slice(0, 10);
    } else if (typeof obj.model === 'string' && obj.model.trim()) {
      models = [obj.model];
    } else {
      models = [...fallback.models];
    }
    if (models.length === 0) models = [''];

    const organizationId =
      typeof obj.organizationId === 'string' ? obj.organizationId : fallback.organizationId;
    const supportsVision =
      typeof obj.supportsVision === 'boolean' ? obj.supportsVision : fallback.supportsVision;
    const visionMaxImages =
      typeof obj.visionMaxImages === 'number' && Number.isFinite(obj.visionMaxImages)
        ? Math.max(0, Math.floor(obj.visionMaxImages))
        : fallback.visionMaxImages;
    const visionMaxBytes =
      typeof obj.visionMaxBytes === 'number' && Number.isFinite(obj.visionMaxBytes)
        ? Math.max(0, Math.floor(obj.visionMaxBytes))
        : fallback.visionMaxBytes;

    const out: Partial<AIConfig> = {
      endpoint,
      apiKey,
      models,
      supportsVision,
      visionMaxImages,
      visionMaxBytes,
    };
    if (provider === 'openai') out.organizationId = organizationId || '';
    return out;
  };

  const createProfileId = () => `cfg_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('openai');
  const [activeConfigTab, setActiveConfigTab] = useState<AIConfigTab>('openai');
  const [profiles, setProfiles] = useState<AIProfiles>(() => createDefaultProfiles());
  const [configs, setConfigs] = useState<Record<AIProvider, Partial<AIConfig>>>(() => ({
    openai: { ...DEFAULT_AI_CONFIGS.openai },
    anthropic: { ...DEFAULT_AI_CONFIGS.anthropic },
    gemini: { ...DEFAULT_AI_CONFIGS.gemini },
    ollama: { ...DEFAULT_AI_CONFIGS.ollama },
  }));
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [testResultsByProfileId, setTestResultsByProfileId] = useState<
    Record<string, { success: boolean; message: string } | null>
  >({});
  const [fetchingModelsProfileId, setFetchingModelsProfileId] = useState<string | null>(null);
  const [modelFetchByProfileId, setModelFetchByProfileId] = useState<
    Record<string, { models: string[]; error?: string }>
  >({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<{
    provider: AIProvider;
    profileId: string;
    name: string;
  } | null>(null);
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [imageGeneration, setImageGeneration] = useState<ImageGenerationConfig>(
    DEFAULT_IMAGE_GENERATION_CONFIG
  );

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const loadedConfig = JSON.parse(configStr);
          const nextSelectedProvider: AIProvider = loadedConfig.selectedProvider || 'openai';
          const loadedConfigsRaw = loadedConfig.configs || null;
          const loadedConfigsMigrated: Partial<Record<AIProvider, Partial<AIConfig>>> =
            loadedConfigsRaw
              ? Object.entries(loadedConfigsRaw).reduce(
                  (
                    acc: Partial<Record<AIProvider, Partial<AIConfig>>>,
                    [key, value]: [string, unknown]
                  ) => {
                    if (
                      key === 'openai' ||
                      key === 'anthropic' ||
                      key === 'gemini' ||
                      key === 'ollama'
                    ) {
                      acc[key as AIProvider] = normalizeConfigValue(key as AIProvider, value);
                    }
                    return acc;
                  },
                  {}
                )
              : {};

          const nextConfigs: Record<AIProvider, Partial<AIConfig>> = {
            openai: { ...DEFAULT_AI_CONFIGS.openai, ...(loadedConfigsMigrated.openai || {}) },
            anthropic: {
              ...DEFAULT_AI_CONFIGS.anthropic,
              ...(loadedConfigsMigrated.anthropic || {}),
            },
            gemini: { ...DEFAULT_AI_CONFIGS.gemini, ...(loadedConfigsMigrated.gemini || {}) },
            ollama: { ...DEFAULT_AI_CONFIGS.ollama, ...(loadedConfigsMigrated.ollama || {}) },
          };

          let nextProfiles: AIProfiles;
          if (loadedConfig.profiles && typeof loadedConfig.profiles === 'object') {
            const rawProfiles = loadedConfig.profiles as Record<
              AIProvider,
              { items?: unknown[]; activeId?: string }
            >;
            const buildProviderProfiles = (provider: AIProvider): AIProviderProfiles => {
              const raw = rawProfiles[provider];
              const itemsRaw = raw && Array.isArray(raw.items) ? raw.items : [];
              const items: AIProfileItem[] = itemsRaw
                .map((it: unknown, idx: number) => {
                  const item = it as Record<string, unknown>;
                  const cfg = normalizeConfigValue(provider, it);
                  const id =
                    typeof item?.id === 'string' && item.id.trim()
                      ? item.id
                      : `migrated_${provider}_${idx}_${Date.now()}`;
                  const name =
                    typeof item?.name === 'string' && item.name.trim()
                      ? item.name
                      : `配置${idx + 1}`;
                  return { id, name, ...cfg } as AIProfileItem;
                })
                .filter((it: AIProfileItem) => it.models && it.models.length > 0);

              if (items.length === 0) {
                const id = `default-${provider}`;
                return {
                  activeId: id,
                  items: [{ id, name: t.common.defaultConfig, ...nextConfigs[provider] } as AIProfileItem],
                };
              }

              const rawActiveId = typeof raw?.activeId === 'string' ? raw.activeId : '';
              const activeId = items.some((it) => it.id === rawActiveId)
                ? rawActiveId
                : items[0].id;
              return { activeId, items };
            };

            nextProfiles = {
              openai: buildProviderProfiles('openai'),
              anthropic: buildProviderProfiles('anthropic'),
              gemini: buildProviderProfiles('gemini'),
              ollama: buildProviderProfiles('ollama'),
            };

            (['openai', 'anthropic', 'gemini', 'ollama'] as AIProvider[]).forEach((p) => {
              const active = nextProfiles[p].items.find((it) => it.id === nextProfiles[p].activeId);
              if (active) {
                const snapshot = nextConfigs[p];
                Object.assign(active, snapshot);
              }
            });
          } else {
            const makeProviderProfiles = (provider: AIProvider): AIProviderProfiles => {
              const id = `default-${provider}`;
              return {
                activeId: id,
                items: [{ id, name: t.common.defaultConfig, ...nextConfigs[provider] } as AIProfileItem],
              };
            };
            nextProfiles = {
              openai: makeProviderProfiles('openai'),
              anthropic: makeProviderProfiles('anthropic'),
              gemini: makeProviderProfiles('gemini'),
              ollama: makeProviderProfiles('ollama'),
            };
          }

          setSelectedProvider(nextSelectedProvider);
          setActiveConfigTab(nextSelectedProvider);
          setProfiles(nextProfiles);
          setConfigs(nextConfigs);
          setImageGeneration(normalizeImageGenerationConfig(loadedConfig.imageGeneration));
          setExpandedProfileId(null);
        }
      } catch (error) {
        console.error('加载配置失败:', error);
        setMessage({ type: 'error', text: `加载配置失败: ${error}` });
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  const updateProfileItem = (
    provider: AIProvider,
    profileId: string,
    patch: Partial<AIProfileItem>
  ) => {
    setProfiles((prev) => {
      const providerProfiles = prev[provider];
      const isActive = providerProfiles.activeId === profileId;
      const items = providerProfiles.items.map((it) =>
        it.id === profileId ? { ...it, ...patch } : it
      );

      if (isActive) {
        setConfigs((prevConfigs) => {
          const current = prevConfigs[provider] || {};
          const next = { ...current, ...patch };
          return { ...prevConfigs, [provider]: next };
        });
      }

      return { ...prev, [provider]: { ...providerProfiles, items } };
    });
  };

  const handleProfileConfigChange = (
    profileId: string,
    field: keyof AIConfig,
    value: string | string[]
  ) => {
    const patch: Partial<AIConfig> = { [field]: value };
    updateProfileItem(selectedProvider, profileId, patch);
  };

  const handleAddModel = (profileId: string) => {
    const providerProfiles = profiles[selectedProvider];
    const target = providerProfiles.items.find((it) => it.id === profileId);
    const currentModels = target?.models || [];
    if (currentModels.length < 10) {
      handleProfileConfigChange(profileId, 'models', [...currentModels, '']);
    }
  };

  const handleRemoveModel = (profileId: string, index: number) => {
    const providerProfiles = profiles[selectedProvider];
    const target = providerProfiles.items.find((it) => it.id === profileId);
    const currentModels = target?.models || [];
    if (currentModels.length > 1) {
      handleProfileConfigChange(
        profileId,
        'models',
        currentModels.filter((_, i) => i !== index)
      );
    }
  };

  const handleModelChange = (profileId: string, index: number, value: string) => {
    const providerProfiles = profiles[selectedProvider];
    const target = providerProfiles.items.find((it) => it.id === profileId);
    const currentModels = [...(target?.models || [])];
    currentModels[index] = value;
    handleProfileConfigChange(profileId, 'models', currentModels);
  };

  const persistConfig = async (
    nextSelectedProvider: AIProvider,
    nextConfigs: Record<AIProvider, Partial<AIConfig>>,
    nextProfiles: AIProfiles,
    nextImageGeneration: ImageGenerationConfig = imageGeneration
  ) => {
    setIsSaving(true);
    setMessage(null);

    try {
      const configStr = await invoke<string>('load_ai_config');
      const existing: Record<string, unknown> = configStr ? JSON.parse(configStr) : {};

      const configData = JSON.stringify({
        ...existing,
        selectedProvider: nextSelectedProvider,
        configs: nextConfigs,
        profiles: nextProfiles,
        imageGeneration: nextImageGeneration,
      });

      await invoke<string>('save_ai_config', { config: configData });

      try {
        await emit('ai-config-updated', null);
      } catch {
        // Event emission may fail if no listeners, ignore
      }
    } catch (error) {
      setMessage({ type: 'error', text: `保存失败: ${error}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveConfig = async () => {
    await persistConfig(selectedProvider, configs, profiles);
  };

  const handleEnableProfile = async (provider: AIProvider, profileId: string) => {
    const providerProfiles = profiles[provider];
    const target = providerProfiles.items.find((it) => it.id === profileId);
    if (!target) return;

    const nextProfiles: AIProfiles = {
      ...profiles,
      [provider]: {
        ...providerProfiles,
        activeId: profileId,
      },
    };

    const nextConfigs: Record<AIProvider, Partial<AIConfig>> = {
      ...configs,
      [provider]: {
        endpoint: target.endpoint,
        apiKey: target.apiKey,
        models: target.models,
        organizationId: provider === 'openai' ? target.organizationId || '' : undefined,
      },
    };

    setSelectedProvider(provider);
    setProfiles(nextProfiles);
    setConfigs(nextConfigs);
    await persistConfig(provider, nextConfigs, nextProfiles);
  };

  const handleAddProfile = () => {
    const providerProfiles = profiles[selectedProvider];
    const nextIndex = providerProfiles.items.length + 1;
    const id = createProfileId();
    const item: AIProfileItem = {
      id,
      name: `配置${nextIndex}`,
      endpoint: '',
      apiKey: '',
      models: [''],
      organizationId: selectedProvider === 'openai' ? '' : undefined,
    };

    setProfiles((prev) => ({
      ...prev,
      [selectedProvider]: {
        ...prev[selectedProvider],
        items: [...prev[selectedProvider].items, item],
      },
    }));
  };

  const requestDeleteProfile = (provider: AIProvider, profileId: string) => {
    const providerProfiles = profiles[provider];
    const target = providerProfiles.items.find((it) => it.id === profileId);
    if (!target) return;
    setPendingDeleteProfile({ provider, profileId, name: target.name });
  };

  const startRenameProfile = (profileId: string) => {
    const providerProfiles = profiles[selectedProvider];
    const target = providerProfiles.items.find((it) => it.id === profileId);
    if (!target) return;
    setRenamingProfileId(profileId);
    setRenameValue(target.name);
  };

  const saveRenameProfile = async (profileId: string) => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenamingProfileId(null);
      return;
    }

    const providerProfiles = profiles[selectedProvider];
    const items = providerProfiles.items.map((it) =>
      it.id === profileId ? { ...it, name: nextName } : it
    );
    const nextProfiles: AIProfiles = {
      ...profiles,
      [selectedProvider]: {
        ...providerProfiles,
        items,
      },
    };

    setProfiles(nextProfiles);
    setRenamingProfileId(null);
    setRenameValue('');

    await persistConfig(selectedProvider, configs, nextProfiles);
  };

  const cancelRename = () => {
    setRenamingProfileId(null);
    setRenameValue('');
  };

  const handleDeleteProfile = async (provider: AIProvider, profileId: string) => {
    const providerProfiles = profiles[provider];
    if (providerProfiles.items.length <= 1) return;

    const items = providerProfiles.items.filter((it) => it.id !== profileId);
    const deletingActive = providerProfiles.activeId === profileId;
    const nextActiveId = deletingActive ? items[0].id : providerProfiles.activeId;
    const nextProviderProfiles: AIProviderProfiles = { activeId: nextActiveId, items };
    const nextProfiles: AIProfiles = { ...profiles, [provider]: nextProviderProfiles };
    const nextConfigs: Record<AIProvider, Partial<AIConfig>> = deletingActive
      ? (() => {
          const nextActive = items[0];
          return {
            ...configs,
            [provider]: {
              endpoint: nextActive.endpoint,
              apiKey: nextActive.apiKey,
              models: nextActive.models,
              organizationId: provider === 'openai' ? nextActive.organizationId || '' : undefined,
            },
          };
        })()
      : configs;

    setProfiles(nextProfiles);

    if (deletingActive) {
      setConfigs(nextConfigs);
    }

    if (provider === selectedProvider && expandedProfileId === profileId) {
      setExpandedProfileId(null);
    }

    await persistConfig(selectedProvider, nextConfigs, nextProfiles);
  };

  const confirmDeleteProfile = async () => {
    if (!pendingDeleteProfile) return;
    const { provider, profileId } = pendingDeleteProfile;
    setPendingDeleteProfile(null);
    await handleDeleteProfile(provider, profileId);
  };

  const clearFetchedModelsForProfile = (profileId: string) => {
    setModelFetchByProfileId((prev) => {
      const { [profileId]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleCopyModel = async (model: string) => {
    try {
      await navigator.clipboard.writeText(model);
      globalShowSuccess(t.settingsAiConfig.form.modelCopied);
    } catch {
      // Clipboard may be unavailable in some environments
    }
  };

  const handleFetchModels = async (profileId: string) => {
    setFetchingModelsProfileId(profileId);

    try {
      const providerProfiles = profiles[selectedProvider];
      const target = providerProfiles.items.find((it) => it.id === profileId);
      if (!target) {
        setFetchingModelsProfileId(null);
        return;
      }

      const requiresApiKey = selectedProvider !== 'ollama';
      if (!target.endpoint || (requiresApiKey && !target.apiKey)) {
        setModelFetchByProfileId((prev) => ({
          ...prev,
          [profileId]: {
            models: [],
            error: t.settingsAiConfig.errors.incompleteConfig,
          },
        }));
        setFetchingModelsProfileId(null);
        return;
      }

      const result = await invoke<{ success: boolean; message: string; models: string[] }>(
        'list_ai_models',
        {
          provider: selectedProvider,
          config: {
            endpoint: target.endpoint,
            apiKey: target.apiKey,
            organizationId: target.organizationId,
          },
        }
      );

      if (result.success) {
        setModelFetchByProfileId((prev) => ({
          ...prev,
          [profileId]: { models: result.models },
        }));
      } else {
        setModelFetchByProfileId((prev) => ({
          ...prev,
          [profileId]: {
            models: [],
            error: result.message || t.errors.loadModelListFailed,
          },
        }));
      }
    } catch (error) {
      setModelFetchByProfileId((prev) => ({
        ...prev,
        [profileId]: {
          models: [],
          error: `${t.errors.loadModelListFailed}: ${String(error)}`,
        },
      }));
    } finally {
      setFetchingModelsProfileId(null);
    }
  };

  const handleTestConnection = async (profileId: string) => {
    setTestingProfileId(profileId);
    setTestResultsByProfileId((prev) => ({ ...prev, [profileId]: null }));

    try {
      const providerProfiles = profiles[selectedProvider];
      const target = providerProfiles.items.find((it) => it.id === profileId);
      if (!target) {
        setTestingProfileId(null);
        return;
      }

      const requiresApiKey = selectedProvider !== 'ollama';
      if (
        !target.endpoint ||
        (requiresApiKey && !target.apiKey) ||
        !target.models ||
        target.models.length === 0 ||
        !target.models[0]
      ) {
        setTestResultsByProfileId((prev) => ({
          ...prev,
          [profileId]: { success: false, message: t.settingsAiConfig.errors.incompleteConfig },
        }));
        setTestingProfileId(null);
        return;
      }

      const result = await invoke<{ success: boolean; message: string }>('test_ai_connection', {
        provider: selectedProvider,
        config: {
          endpoint: target.endpoint,
          apiKey: target.apiKey,
          models: target.models,
          organizationId: target.organizationId,
          model: target.models[0],
        },
      });

      setTestResultsByProfileId((prev) => ({ ...prev, [profileId]: result }));
    } catch (error) {
      setTestResultsByProfileId((prev) => ({
        ...prev,
        [profileId]: { success: false, message: t.settingsAiConfig.errors.testFailed.replace('{error}', String(error)) },
      }));
    } finally {
      setTestingProfileId(null);
    }
  };

  if (isLoading) {
    return <div className={styles.loading}>{t.settingsAiConfig.loading}</div>;
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{t.settingsAiConfig.title}</h2>
      </header>

      {message && (
        <div className={`${styles.message} ${message.type === 'success' ? styles.messageSuccess : styles.messageError}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className={styles.messageClose}>
            ×
          </button>
        </div>
      )}

      <ConfigTabSelector
        activeTab={activeConfigTab}
        imageGenTabLabel={t.settingsAiConfig.imageGeneration.tabLabel}
        onSelectTab={(tab) => {
          setActiveConfigTab(tab);
          if (tab !== 'image-generation') {
            setSelectedProvider(tab);
            setExpandedProfileId(null);
            setModelFetchByProfileId({});
          }
        }}
      />

      {activeConfigTab === 'image-generation' ? (
        <ImageGenerationSection
          embeddedInTab
          config={imageGeneration}
          onChange={(patch) => {
            setImageGeneration((prev) => ({ ...prev, ...patch }));
          }}
          onSave={() => void persistConfig(selectedProvider, configs, profiles, imageGeneration)}
          isSaving={isSaving}
        />
      ) : (
      <div>
        <div className={styles.toolbar}>
          <div className={styles.toolbarHint}>{t.settingsAiConfig.hint}</div>
          <button type="button" onClick={handleAddProfile} className={styles.addButton}>
            <PlusIcon size={12} />
            {t.settingsAiConfig.addProfile}
          </button>
        </div>

        <div className={styles.profileList}>
        {profiles[selectedProvider].items.map((item) => {
          const isActive = profiles[selectedProvider].activeId === item.id;
          const isExpanded = expandedProfileId === item.id;
          const isRenaming = renamingProfileId === item.id;
          const shortEndpoint = (item.endpoint || '').replace(/^https?:\/\//, '').slice(0, 48);
          return (
            <ProfileCard
              key={item.id}
              title={item.name}
              subtitle={shortEndpoint}
              badge={isActive ? t.settingsAiConfig.enabled : ''}
              isActive={isActive}
              isExpanded={isExpanded}
              isRenaming={isRenaming}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={() => void saveRenameProfile(item.id)}
              onRenameCancel={cancelRename}
              onToggle={() => {
                if (expandedProfileId === item.id) {
                  clearFetchedModelsForProfile(item.id);
                  setExpandedProfileId(null);
                } else {
                  setExpandedProfileId(item.id);
                }
              }}
              onEdit={() => startRenameProfile(item.id)}
              onEnable={
                isActive ? undefined : () => void handleEnableProfile(selectedProvider, item.id)
              }
              onDelete={
                profiles[selectedProvider].items.length > 1
                  ? () => requestDeleteProfile(selectedProvider, item.id)
                  : undefined
              }
            >
              <ConfigForm
                provider={selectedProvider}
                config={item}
                onConfigChange={(field, value) =>
                  handleProfileConfigChange(item.id, field, value)
                }
                onSave={handleSaveConfig}
                onTest={() => void handleTestConnection(item.id)}
                onFetchModels={() => void handleFetchModels(item.id)}
                isSaving={isSaving}
                isTesting={testingProfileId === item.id}
                isFetchingModels={fetchingModelsProfileId === item.id}
                testResult={testResultsByProfileId[item.id] || null}
                modelFetch={modelFetchByProfileId[item.id]}
                onCopyModel={(model) => void handleCopyModel(model)}
                onAddModel={() => handleAddModel(item.id)}
                onRemoveModel={(index) => handleRemoveModel(item.id, index)}
                onModelChange={(index, value) => handleModelChange(item.id, index, value)}
              />
            </ProfileCard>
          );
        })}
        </div>
      </div>
      )}

      {pendingDeleteProfile && (
        <SettingsDeleteModal
          title={t.settingsAiConfig.deleteProfile.title}
          onCancel={() => setPendingDeleteProfile(null)}
          onConfirm={confirmDeleteProfile}
          confirmLabel={t.settingsAiConfig.confirmDelete}
        >
          确定删除"{pendingDeleteProfile.name}"吗？删除后无法恢复。
        </SettingsDeleteModal>
      )}
    </div>
  );
}
