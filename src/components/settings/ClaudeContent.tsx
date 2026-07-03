import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import {
  showError as globalShowError,
  showSuccess as globalShowSuccess,
} from '../../utils/notification';
import styles from './ClaudeContent.module.css';
import pageStyles from './SettingsPage.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';

interface ClaudeConfigItem {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  mainModel: string;
  thinkingModel: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

const defaultClaudeConfig = (): Omit<ClaudeConfigItem, 'id' | 'createdAt' | 'updatedAt'> => ({
  name: '',
  endpoint: '',
  apiKey: '',
  mainModel: '',
  thinkingModel: '',
  haikuModel: '',
  sonnetModel: '',
  opusModel: '',
  enabled: true,
});

type ClaudeConfigFields = Omit<ClaudeConfigItem, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>;

function ConfigFormFields({
  config,
  onChange,
}: {
  config: ClaudeConfigFields;
  onChange: (config: ClaudeConfigFields) => void;
}) {
  const t = useTranslation();
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | undefined>();
  const jsonEditedRef = useRef(false);

  const configToJson = (cfg: ClaudeConfigFields) => JSON.stringify({
    env: {
      ANTHROPIC_AUTH_TOKEN: cfg.apiKey || '',
      ANTHROPIC_BASE_URL: cfg.endpoint || '',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: cfg.haikuModel || '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: cfg.opusModel || '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: cfg.sonnetModel || '',
      ANTHROPIC_MODEL: cfg.mainModel || '',
      ANTHROPIC_REASONING_MODEL: cfg.thinkingModel || '',
    },
    skipDangerousModePermissionPrompt: true,
  }, null, 2);

  useEffect(() => {
    if (!jsonEditedRef.current) {
      setJsonText(configToJson(config));
    }
  }, [config]);

  const handleFieldChange = (patch: Partial<ClaudeConfigFields>) => {
    jsonEditedRef.current = false;
    const next = { ...config, ...patch };
    onChange(next);
    setJsonText(configToJson(next));
    setJsonError(undefined);
  };

  const handleJsonChange = (value: string) => {
    jsonEditedRef.current = true;
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed.env && typeof parsed.env === 'object') {
        onChange({
          name: config.name,
          endpoint: parsed.env.ANTHROPIC_BASE_URL ?? '',
          apiKey: parsed.env.ANTHROPIC_AUTH_TOKEN ?? '',
          mainModel: parsed.env.ANTHROPIC_MODEL ?? '',
          thinkingModel: parsed.env.ANTHROPIC_REASONING_MODEL ?? '',
          haikuModel: parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? '',
          sonnetModel: parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
          opusModel: parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? '',
        });
        setJsonError(undefined);
      }
    } catch {
      setJsonError('JSON 格式错误');
    }
  };

  return (
    <>
      <div className={styles.skillFormField}>
        <label className={styles.skillFormLabel}>{t.settingsClaude.configName}</label>
        <input
          type="text"
          className={styles.skillFormInput}
          placeholder={t.settingsClaude.configNamePlaceholder}
          value={config.name}
          onChange={(e) => handleFieldChange({ name: e.target.value })}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.endpoint}</label>
          <input
            type="text"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.endpointPlaceholder}
            value={config.endpoint}
            onChange={(e) => handleFieldChange({ endpoint: e.target.value })}
          />
        </div>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.apiKey}</label>
          <input
            type="password"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.apiKeyPlaceholder}
            value={config.apiKey}
            onChange={(e) => handleFieldChange({ apiKey: e.target.value })}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.mainModel}</label>
          <input
            type="text"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.mainModelPlaceholder}
            value={config.mainModel}
            onChange={(e) => handleFieldChange({ mainModel: e.target.value })}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.thinkingModel}</label>
          <input
            type="text"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.thinkingModelPlaceholder}
            value={config.thinkingModel}
            onChange={(e) => handleFieldChange({ thinkingModel: e.target.value })}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.haikuModel}</label>
          <input
            type="text"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.haikuModelPlaceholder}
            value={config.haikuModel}
            onChange={(e) => handleFieldChange({ haikuModel: e.target.value })}
            style={{ fontFamily: 'monospace', fontSize: '11px' }}
          />
        </div>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.sonnetModel}</label>
          <input
            type="text"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.sonnetModelPlaceholder}
            value={config.sonnetModel}
            onChange={(e) => handleFieldChange({ sonnetModel: e.target.value })}
            style={{ fontFamily: 'monospace', fontSize: '11px' }}
          />
        </div>
        <div className={styles.skillFormField}>
          <label className={styles.skillFormLabel}>{t.settingsClaude.opusModel}</label>
          <input
            type="text"
            className={styles.skillFormInput}
            placeholder={t.settingsClaude.opusModelPlaceholder}
            value={config.opusModel}
            onChange={(e) => handleFieldChange({ opusModel: e.target.value })}
            style={{ fontFamily: 'monospace', fontSize: '11px' }}
          />
        </div>
      </div>
      <div style={{ marginTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <label className={styles.skillFormLabel} style={{ marginBottom: 0 }}>{t.settingsClaude.configContent}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {jsonError && <span style={{ color: '#f48771', fontSize: '11px' }}>{jsonError}</span>}
            <button
              type="button"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonText);
                  const formatted = JSON.stringify(parsed, null, 2);
                  handleJsonChange(formatted);
                } catch { /* ignore */ }
              }}
              style={{
                padding: '2px 8px', fontSize: '11px', borderRadius: '4px',
                border: '1px solid var(--surface-overlay-border)',
                backgroundColor: 'var(--surface-overlay-soft)',
                color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              格式化
            </button>
          </div>
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%', minHeight: '180px',
            backgroundColor: 'var(--bg-input)', border: `1px solid ${jsonError ? '#f48771' : 'var(--border-primary)'}`,
            borderRadius: '6px', padding: '12px', fontSize: '11px',
            fontFamily: 'Consolas, Monaco, monospace', color: 'var(--text-primary)',
            resize: 'vertical', outline: 'none', lineHeight: '1.5',
            boxSizing: 'border-box', tabSize: 2, whiteSpace: 'pre', overflowX: 'auto',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = jsonError ? '#f48771' : '#007acc'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = jsonError ? '#f48771' : 'var(--border-primary)'; }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const ta = e.currentTarget;
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              const newVal = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
              handleJsonChange(newVal);
              requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
            }
          }}
        />
      </div>
    </>
  );
}

function ClaudeConfigCard({
  config,
  isEditing,
  editConfig,
  onEditConfigChange,
  onWrite,
  isWriting,
  isWritten,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  saving,
  t,
}: {
  config: ClaudeConfigItem;
  isEditing: boolean;
  editConfig: Omit<ClaudeConfigItem, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>;
  onEditConfigChange: (config: Omit<ClaudeConfigItem, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>) => void;
  onWrite: () => void;
  isWriting: boolean;
  isWritten: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  saving: boolean;
  t: ReturnType<typeof useTranslation>;
}) {
  const configToJson = (cfg: typeof editConfig) => JSON.stringify({
    env: {
      ANTHROPIC_AUTH_TOKEN: cfg.apiKey || '',
      ANTHROPIC_BASE_URL: cfg.endpoint || '',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: cfg.haikuModel || '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: cfg.opusModel || '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: cfg.sonnetModel || '',
      ANTHROPIC_MODEL: cfg.mainModel || '',
      ANTHROPIC_REASONING_MODEL: cfg.thinkingModel || '',
    },
    skipDangerousModePermissionPrompt: true,
  }, null, 2);

  const [jsonText, setJsonText] = useState(() => configToJson(editConfig));
  const [jsonError, setJsonError] = useState<string | undefined>();

  const jsonEditedRef = useRef(false);
  useEffect(() => {
    if (isEditing && !jsonEditedRef.current) {
      setJsonText(configToJson(editConfig));
    }
  }, [isEditing, editConfig]);

  useEffect(() => {
    if (!isEditing) {
      jsonEditedRef.current = false;
      setJsonError(undefined);
    }
  }, [isEditing]);

  const handleJsonTextChange = (value: string) => {
    jsonEditedRef.current = true;
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed.env && typeof parsed.env === 'object') {
        onEditConfigChange({
          name: editConfig.name,
          endpoint: parsed.env.ANTHROPIC_BASE_URL ?? editConfig.endpoint,
          apiKey: parsed.env.ANTHROPIC_AUTH_TOKEN ?? editConfig.apiKey,
          mainModel: parsed.env.ANTHROPIC_MODEL ?? editConfig.mainModel,
          thinkingModel: parsed.env.ANTHROPIC_REASONING_MODEL ?? editConfig.thinkingModel,
          haikuModel: parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? editConfig.haikuModel,
          sonnetModel: parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? editConfig.sonnetModel,
          opusModel: parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? editConfig.opusModel,
        });
        setJsonError(undefined);
      }
    } catch {
      setJsonError('JSON 格式错误');
    }
  };

  const handleFieldChange = (patch: Partial<typeof editConfig>) => {
    const next = { ...editConfig, ...patch };
    onEditConfigChange(next);
    jsonEditedRef.current = false;
    setJsonText(configToJson(next));
    setJsonError(undefined);
  };

  return (
    <div className={styles.skillCard}>
      <div className={styles.skillCardHeader}>
        <div className={styles.skillCardInfo}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isEditing ? (
              <input
                type="text"
                value={editConfig.name}
                onChange={(e) => handleFieldChange({ name: e.target.value })}
                className={styles.skillFormInput}
                style={{ width: '200px' }}
                autoFocus
              />
            ) : (
              <span className={styles.skillCardName}>{config.name}</span>
            )}
          </div>
          {!isEditing && (
            <span className={styles.skillCardPreview}>
              {config.endpoint} · {config.mainModel}
            </span>
          )}
        </div>
        <div className={styles.skillCardActions}>
          <button
            className={styles.skillActionBtn}
            onClick={onWrite}
            disabled={isWriting || isEditing}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              color: isWritten ? '#4ade80' : isWriting ? 'var(--text-secondary)' : 'var(--text-accent)',
              fontWeight: 500,
              cursor: isWriting || isEditing ? 'not-allowed' : 'pointer',
              opacity: isEditing ? 0.4 : 1,
              transition: 'color 0.25s, opacity 0.25s',
            }}
            title="写入配置到 ~/.claude/settings.json"
          >
            {isWriting ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : isWritten ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
            {isWriting ? '写入中...' : isWritten ? '已写入' : '写入'}
          </button>
          {isEditing ? (
            <>
              <button
                className={styles.skillActionBtn}
                onClick={onCancelEdit}
                disabled={saving}
                style={{ color: 'var(--text-secondary)' }}
              >
                {t.actions.cancel}
              </button>
              <button
                className={styles.skillActionBtn}
                onClick={onSaveEdit}
                disabled={saving}
                style={{ color: '#4ade80' }}
              >
                {saving ? '...' : t.actions.save}
              </button>
            </>
          ) : (
            <>
              <button
                className={styles.skillActionBtn}
                onClick={onStartEdit}
              >
                {t.actions.edit}
              </button>
              <button
                className={styles.skillDeleteBtn}
                onClick={onDelete}
              >
                {t.actions.delete}
              </button>
            </>
          )}
        </div>
      </div>
      {isEditing && (
        <div className={styles.skillCardBody}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className={styles.skillFormField} style={{ marginBottom: 0 }}>
                <label className={styles.skillFormLabel}>{t.settingsClaude.endpoint}</label>
                <input
                  type="text"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.endpointPlaceholder}
                  value={editConfig.endpoint}
                  onChange={(e) => handleFieldChange({ endpoint: e.target.value })}
                />
              </div>
              <div className={styles.skillFormField} style={{ marginBottom: 0 }}>
                <label className={styles.skillFormLabel}>{t.settingsClaude.apiKey}</label>
                <input
                  type="password"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.apiKeyPlaceholder}
                  value={editConfig.apiKey}
                  onChange={(e) => handleFieldChange({ apiKey: e.target.value })}
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
            </div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className={styles.skillFormField} style={{ marginBottom: 0 }}>
                <label className={styles.skillFormLabel}>{t.settingsClaude.mainModel}</label>
                <input
                  type="text"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.mainModelPlaceholder}
                  value={editConfig.mainModel}
                  onChange={(e) => handleFieldChange({ mainModel: e.target.value })}
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div className={styles.skillFormField} style={{ marginBottom: 0 }}>
                <label className={styles.skillFormLabel}>{t.settingsClaude.thinkingModel}</label>
                <input
                  type="text"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.thinkingModelPlaceholder}
                  value={editConfig.thinkingModel}
                  onChange={(e) => handleFieldChange({ thinkingModel: e.target.value })}
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
            </div>
          </div>
          <div className={styles.skillFormField} style={{ marginBottom: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label className={styles.skillFormLabel}>{t.settingsClaude.haikuModel}</label>
                <input
                  type="text"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.haikuModelPlaceholder}
                  value={editConfig.haikuModel}
                  onChange={(e) => handleFieldChange({ haikuModel: e.target.value })}
                  style={{ fontFamily: 'monospace', fontSize: '11px' }}
                />
              </div>
              <div>
                <label className={styles.skillFormLabel}>{t.settingsClaude.sonnetModel}</label>
                <input
                  type="text"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.sonnetModelPlaceholder}
                  value={editConfig.sonnetModel}
                  onChange={(e) => handleFieldChange({ sonnetModel: e.target.value })}
                  style={{ fontFamily: 'monospace', fontSize: '11px' }}
                />
              </div>
              <div>
                <label className={styles.skillFormLabel}>{t.settingsClaude.opusModel}</label>
                <input
                  type="text"
                  className={styles.skillFormInput}
                  placeholder={t.settingsClaude.opusModelPlaceholder}
                  value={editConfig.opusModel}
                  onChange={(e) => handleFieldChange({ opusModel: e.target.value })}
                  style={{ fontFamily: 'monospace', fontSize: '11px' }}
                />
              </div>
            </div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label className={styles.skillFormLabel} style={{ marginBottom: 0 }}>{t.settingsClaude.configContent}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {jsonError && <span style={{ color: '#f48771', fontSize: '11px' }}>{jsonError}</span>}
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(jsonText);
                      const formatted = JSON.stringify(parsed, null, 2);
                      handleJsonTextChange(formatted);
                    } catch {
                      // JSON 无效时不做处理
                    }
                  }}
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    border: '1px solid var(--surface-overlay-border)',
                    backgroundColor: 'var(--surface-overlay-soft)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-overlay-soft)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  title="格式化 JSON"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" y1="20" x2="15" y2="20" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                  </svg>
                  格式化
                </button>
              </div>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => handleJsonTextChange(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: '220px',
                backgroundColor: 'var(--bg-input)',
                border: `1px solid ${jsonError ? '#f48771' : 'var(--border-primary)'}`,
                borderRadius: '6px',
                padding: '12px',
                fontSize: '11px',
                fontFamily: 'Consolas, Monaco, monospace',
                color: 'var(--text-primary)',
                resize: 'vertical',
                outline: 'none',
                lineHeight: '1.5',
                boxSizing: 'border-box',
                tabSize: 2,
                whiteSpace: 'pre',
                overflowX: 'auto',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = jsonError ? '#f48771' : '#007acc'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = jsonError ? '#f48771' : 'var(--border-primary)'; }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const val = ta.value;
                  const newVal = val.substring(0, start) + '  ' + val.substring(end);
                  handleJsonTextChange(newVal);
                  requestAnimationFrame(() => {
                    ta.selectionStart = ta.selectionEnd = start + 2;
                  });
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const CLAUDE_CONFIGS_STORAGE_KEY = 'loom:claude-configs:v1';

export function ClaudeContent() {
  const t = useTranslation();
  const [configs, setConfigs] = useState<ClaudeConfigItem[]>(() => {
    try {
      const stored = localStorage.getItem(CLAUDE_CONFIGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (c: unknown) =>
              c && typeof c === 'object' &&
              typeof (c as Record<string, unknown>).id === 'string' &&
              typeof (c as Record<string, unknown>).name === 'string'
          ) as ClaudeConfigItem[];
        }
      }
    } catch {
      // ignore parse errors
    }
    return [];
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<Omit<ClaudeConfigItem, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>>(defaultClaudeConfig());
  const [isCreating, setIsCreating] = useState(false);
  const [newConfig, setNewConfig] = useState<Omit<ClaudeConfigItem, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>>(defaultClaudeConfig());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [writingId, setWritingId] = useState<string | null>(null);
  const [writtenId, setWrittenId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CLAUDE_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    } catch {
      // ignore persist failures
    }
  }, [configs]);

  const handleOpenClaudeConfig = async () => {
    try {
      await invoke('open_claude_config_file');
      const path = await invoke<string>('get_claude_config_path');
      window.dispatchEvent(
        new CustomEvent('open-file-in-editor', { detail: { filePath: path, forceRefresh: true } })
      );
    } catch (e) {
      globalShowError(`${t.errors.openConfigFailed}: ${e}`);
    }
  };

  const handleWriteConfig = async (id: string) => {
    if (writingId) return;
    const target = configs.find(c => c.id === id);
    if (!target) return;

    setWritingId(id);
    setWrittenId(null);

    const configJson = JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: target.apiKey || '',
        ANTHROPIC_BASE_URL: target.endpoint || '',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: target.haikuModel || '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: target.opusModel || '',
        ANTHROPIC_DEFAULT_SONNET_MODEL: target.sonnetModel || '',
        ANTHROPIC_MODEL: target.mainModel || '',
        ANTHROPIC_REASONING_MODEL: target.thinkingModel || '',
      },
      skipDangerousModePermissionPrompt: true,
    }, null, 2);

    try {
      const savedPath = await invoke<string>('save_claude_config', { content: configJson });
      setWrittenId(id);
      globalShowSuccess(`配置「${target.name}」已写入 ${savedPath}`);
      setTimeout(() => setWrittenId(prev => prev === id ? null : prev), 2000);
    } catch (e) {
      globalShowError(`写入配置失败: ${e}`);
    } finally {
      setWritingId(null);
    }
  };

  const handleStartEdit = (config: ClaudeConfigItem) => {
    setEditingId(config.id);
    setEditConfig({
      name: config.name,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      mainModel: config.mainModel,
      thinkingModel: config.thinkingModel,
      haikuModel: config.haikuModel,
      sonnetModel: config.sonnetModel,
      opusModel: config.opusModel,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditConfig(defaultClaudeConfig());
  };

  const handleSaveEdit = () => {
    if (!editConfig.name.trim()) {
      globalShowError(t.settingsClaude.nameRequired);
      return;
    }
    setSaving(true);
    setConfigs(prev => prev.map(c =>
      c.id === editingId
        ? { ...c, ...editConfig, updatedAt: Date.now() }
        : c
    ));
    setEditingId(null);
    setEditConfig(defaultClaudeConfig());
    setSaving(false);
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setNewConfig(defaultClaudeConfig());
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewConfig(defaultClaudeConfig());
  };

  const handleSaveCreate = () => {
    if (!newConfig.name.trim()) {
      globalShowError(t.settingsClaude.nameRequired);
      return;
    }
    setSaving(true);
    const config: ClaudeConfigItem = {
      id: Date.now().toString(),
      ...newConfig,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConfigs(prev => [...prev, config]);
    setIsCreating(false);
    setNewConfig(defaultClaudeConfig());
    setSaving(false);
  };

  const handleDelete = (id: string) => {
    setConfigs(prev => prev.filter(c => c.id !== id));
    setDeleteConfirmId(null);
  };

  const configToDelete = deleteConfirmId ? configs.find(c => c.id === deleteConfirmId) : null;

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <div className={styles.toolbar}>
          <h2 className={pageStyles.pageTitle}>{t.settingsClaude.title}</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleStartCreate}
              disabled={isCreating}
              className={styles.secondaryButton}
            >
              {t.settingsClaude.newConfig}
            </button>
            <button type="button" onClick={handleOpenClaudeConfig} className={styles.secondaryButton}>
              {t.settingsClaude.openConfig}
            </button>
          </div>
        </div>
      </header>
      <p className={styles.sectionDescription}>{t.settingsClaude.description}</p>

      <h3 className={styles.sectionHeading}>{t.settingsClaude.configCards}</h3>

      {isCreating && (
        <div className={styles.skillNewForm}>
          <ConfigFormFields config={newConfig} onChange={setNewConfig} />
          <div className={styles.skillCardFooter}>
            <button
              className={styles.skillCancelBtn}
              onClick={handleCancelCreate}
              disabled={saving}
            >
              {t.actions.cancel}
            </button>
            <button
              className={styles.skillSaveBtn}
              onClick={handleSaveCreate}
              disabled={saving}
            >
              {saving ? t.settingsClaude.saving : t.actions.create}
            </button>
          </div>
        </div>
      )}

      {configs.length === 0 && !isCreating ? (
        <div className={styles.skillsEmpty}>
          <p>{t.settingsClaude.noConfigCards}</p>
          <p style={{ marginTop: '4px', fontSize: '11px' }}>{t.settingsClaude.noConfigCardsHint}</p>
        </div>
      ) : (
        <div className={styles.configList}>
        {configs.map(config => (
          <ClaudeConfigCard
            key={config.id}
            config={config}
            isEditing={editingId === config.id}
            editConfig={editConfig}
            onEditConfigChange={setEditConfig}
            onWrite={() => handleWriteConfig(config.id)}
            isWriting={writingId === config.id}
            isWritten={writtenId === config.id}
            onStartEdit={() => handleStartEdit(config)}
            onCancelEdit={handleCancelEdit}
            onSaveEdit={handleSaveEdit}
            onDelete={() => setDeleteConfirmId(config.id)}
            saving={saving}
            t={t}
          />
        ))}
        </div>
      )}

      {configToDelete && (
        <SettingsDeleteModal
          title={t.settingsClaude.deleteConfig}
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => handleDelete(configToDelete.id)}
        >
          {t.settingsClaude.confirmDelete.replace('此配置', `"${configToDelete.name}"`)}
        </SettingsDeleteModal>
      )}
    </div>
  );
}
