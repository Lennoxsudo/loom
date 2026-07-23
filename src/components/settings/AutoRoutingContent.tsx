import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { useTranslation } from '../../i18n';
import {
  type AIProvider,
  type AIProfileItem,
  type AIProfiles,
  type AutoRoutingEntry,
  type AutoRoutingConfig,
} from './types';
import { showSuccess as globalShowSuccess } from '../../utils/notification';
import { SettingsSelect } from './SettingsPrimitives';
import { ChevronDownIcon, CloseIcon, PlusIcon } from '../shared/Icons';
import styles from './AutoRoutingContent.module.css';

const PROVIDERS: AIProvider[] = ['openai', 'anthropic', 'ollama'];
const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
};

function firstModel(profile: AIProfileItem | undefined): string {
  return profile?.models?.find((m) => m.trim()) ?? '';
}

/** Fill missing profile/model from available profiles so UI display matches saved state. */
function resolveEntryDefaults(
  entry: AutoRoutingEntry,
  profiles: AIProfiles | null
): AutoRoutingEntry {
  const providerProfiles = profiles?.[entry.provider]?.items ?? [];
  let profileId = entry.profileId.trim();
  let model = entry.model.trim();

  const matchedProfile =
    providerProfiles.find((p) => p.id === profileId) ??
    (profileId ? undefined : providerProfiles[0]);

  const selectedProfile = matchedProfile ?? providerProfiles[0];
  if (selectedProfile) {
    profileId = selectedProfile.id;
    const availableModels = selectedProfile.models?.filter((m) => m.trim()) ?? [];
    if (!model || !availableModels.includes(model)) {
      model = availableModels[0] ?? '';
    }
  }

  return { ...entry, profileId, model };
}

function EntryRow({
  entry,
  index,
  total,
  profiles,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  entry: AutoRoutingEntry;
  index: number;
  total: number;
  profiles: AIProfiles;
  onChange: (index: number, field: keyof AutoRoutingEntry, value: string) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  const t = useTranslation();
  const providerProfiles = profiles[entry.provider]?.items ?? [];
  const selectedProfile = providerProfiles.find((p: AIProfileItem) => p.id === entry.profileId);
  const availableModels = selectedProfile?.models ?? [];

  return (
    <div className={styles.entryRow}>
      <div className={styles.entryIndex}>{index + 1}</div>

      <div className={styles.entryFields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>{t.settingsAutoRouting.provider}</label>
          <SettingsSelect
            value={entry.provider}
            options={PROVIDERS.map((p) => ({
              value: p,
              label: PROVIDER_LABELS[p],
            }))}
            onChange={(value) => onChange(index, 'provider', value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>{t.settingsAutoRouting.profile}</label>
          <SettingsSelect
            value={entry.profileId}
            placeholder="No profiles"
            options={providerProfiles.map((p: AIProfileItem) => ({
              value: p.id,
              label: p.name || p.id,
            }))}
            onChange={(value) => onChange(index, 'profileId', value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>{t.settingsAutoRouting.model}</label>
          <SettingsSelect
            value={entry.model}
            mono
            placeholder="No models"
            options={availableModels
              .filter((m: string) => m.trim())
              .map((m: string) => ({
                value: m,
                label: m,
              }))}
            onChange={(value) => onChange(index, 'model', value)}
          />
        </div>
      </div>

      <div className={styles.entryActions}>
        <button
          type="button"
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          className={styles.iconButton}
          title={t.settingsAutoRouting.moveUp}
        >
          <span className={styles.chevronUp}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1}
          className={styles.iconButton}
          title={t.settingsAutoRouting.moveDown}
        >
          <ChevronDownIcon size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(index)}
          className={`${styles.iconButton} ${styles.iconButtonDanger}`}
          title={t.settingsAutoRouting.deleteEntry}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  );
}

export function AutoRoutingContent() {
  const t = useTranslation();

  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<AutoRoutingEntry[]>([]);
  const [profiles, setProfiles] = useState<AIProfiles | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const enabledRef = useRef(enabled);
  const entriesRef = useRef(entries);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  const setEnabledSync = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    setEnabled((prev) => {
      const next =
        typeof updater === 'function' ? (updater as (prev: boolean) => boolean)(prev) : updater;
      enabledRef.current = next;
      return next;
    });
  }, []);

  const setEntriesSync = useCallback(
    (updater: AutoRoutingEntry[] | ((prev: AutoRoutingEntry[]) => AutoRoutingEntry[])) => {
      setEntries((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (prev: AutoRoutingEntry[]) => AutoRoutingEntry[])(prev)
            : updater;
        entriesRef.current = next;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (cancelled) return;
        if (configStr) {
          const config = JSON.parse(configStr);
          const loadedProfiles: AIProfiles = config.profiles ?? {};
          const autoRouting: AutoRoutingConfig | undefined = config.autoRouting;

          setProfiles(loadedProfiles);
          if (autoRouting) {
            setEnabledSync(autoRouting.enabled ?? false);
            const knownProviders: AIProvider[] = ['openai', 'anthropic', 'ollama'];
            const loadedEntries = (autoRouting.entries ?? [])
              .map((entry) => {
                const provider =
                  entry.provider === 'openai' ||
                  entry.provider === 'anthropic' ||
                  entry.provider === 'ollama'
                    ? entry.provider
                    : ('openai' as AIProvider);
                return resolveEntryDefaults({ ...entry, provider }, loadedProfiles);
              })
              .filter((entry) => knownProviders.includes(entry.provider));
            setEntriesSync(loadedEntries.length > 0 ? loadedEntries : []);
          }
        }
      } catch (error) {
        console.error('Failed to load AI config:', error);
        if (!cancelled) setMessage({ type: 'error', text: `加载配置失败: ${error}` });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, [setEnabledSync, setEntriesSync]);

  const doSave = useCallback(
    async (saveEnabled: boolean, saveEntries: AutoRoutingEntry[]): Promise<boolean> => {
      setIsSaving(true);
      setMessage(null);

      try {
        const configStr = await invoke<string>('load_ai_config');
        const config: Record<string, unknown> = configStr ? JSON.parse(configStr) : {};

        config.autoRouting = { enabled: saveEnabled, entries: saveEntries };

        await invoke('save_ai_config', { config: JSON.stringify(config) });
        try {
          await emit('ai-config-updated', null);
        } catch {
          /* ignore */
        }

        setHasUnsavedChanges(false);
        return true;
      } catch (error) {
        setMessage({ type: 'error', text: `保存失败: ${error}` });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const handleEntryChange = useCallback(
    (index: number, field: keyof AutoRoutingEntry, value: string) => {
      setEntriesSync((prev) => {
        const next = [...prev];
        const currentProfiles = profilesRef.current;
        if (field === 'provider') {
          const provider = value as AIProvider;
          const providerProfiles = currentProfiles?.[provider]?.items ?? [];
          const firstProfile = providerProfiles[0];
          next[index] = {
            provider,
            profileId: firstProfile?.id ?? '',
            model: firstModel(firstProfile),
          };
        } else if (field === 'profileId') {
          const providerProfiles = currentProfiles?.[next[index].provider]?.items ?? [];
          const selectedProfile = providerProfiles.find((p) => p.id === value);
          next[index] = {
            ...next[index],
            profileId: value,
            model: firstModel(selectedProfile),
          };
        } else {
          next[index] = { ...next[index], [field]: value };
        }
        return next;
      });
      setHasUnsavedChanges(true);
    },
    [setEntriesSync]
  );

  const handleDeleteEntry = useCallback(
    (index: number) => {
      setEntriesSync((prev) => prev.filter((_, i) => i !== index));
      setHasUnsavedChanges(true);
    },
    [setEntriesSync]
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      setEntriesSync((prev) => {
        const next = [...prev];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        return next;
      });
      setHasUnsavedChanges(true);
    },
    [setEntriesSync]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      setEntriesSync((prev) => {
        if (index >= prev.length - 1) return prev;
        const next = [...prev];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        return next;
      });
      setHasUnsavedChanges(true);
    },
    [setEntriesSync]
  );

  const handleAddEntry = useCallback(() => {
    setEntriesSync((prev) => {
      const provider: AIProvider = 'openai';
      const providerProfiles = profilesRef.current?.[provider]?.items ?? [];
      const firstProfile = providerProfiles[0];
      return [
        ...prev,
        {
          provider,
          profileId: firstProfile?.id ?? '',
          model: firstModel(firstProfile),
        },
      ];
    });
    setHasUnsavedChanges(true);
  }, [setEntriesSync]);

  const handleToggle = useCallback(() => {
    const nextEnabled = !enabledRef.current;
    const resolvedEntries = entriesRef.current.map((entry) =>
      resolveEntryDefaults(entry, profilesRef.current)
    );
    setEnabledSync(nextEnabled);
    setEntriesSync(resolvedEntries);
    doSave(
      nextEnabled,
      resolvedEntries.filter((e) => e.profileId && e.model)
    ).then((ok) => {
      if (ok) globalShowSuccess(nextEnabled ? '自动路由已启用' : '自动路由已禁用');
    });
  }, [setEnabledSync, setEntriesSync, doSave]);

  const handleSave = useCallback(() => {
    const resolvedEntries = entries.map((entry) => resolveEntryDefaults(entry, profiles));
    const validEntries = resolvedEntries.filter((e) => e.profileId && e.model);
    const hasIncomplete = resolvedEntries.length > validEntries.length;

    if (resolvedEntries.length > 0 && validEntries.length === 0) {
      setMessage({ type: 'error', text: t.settingsAutoRouting.incompleteEntry });
      return;
    }

    setEntriesSync(resolvedEntries);
    doSave(enabled, validEntries).then((ok) => {
      if (ok) {
        if (hasIncomplete) {
          setMessage({
            type: 'success',
            text: t.settingsAutoRouting.savedPartial
              .replace('{saved}', String(validEntries.length))
              .replace('{skipped}', String(resolvedEntries.length - validEntries.length)),
          });
        } else {
          globalShowSuccess(t.settingsAutoRouting.saveConfig);
        }
      }
    });
  }, [entries, profiles, enabled, setEntriesSync, doSave, t]);

  if (isLoading) {
    return <div className={styles.loading}>{t.common.loading ?? 'Loading...'}</div>;
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{t.settingsAutoRouting.title}</h2>
        <p className={styles.pageDescription}>{t.settingsAutoRouting.description}</p>
      </header>

      {message && (
        <div
          className={`${styles.message} ${message.type === 'success' ? styles.messageSuccess : styles.messageError}`}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className={styles.messageClose}>
            ×
          </button>
        </div>
      )}

      <section className={styles.enablePanel}>
        <div className={styles.enableRow}>
          <span className={styles.enableLabel}>{t.settingsAutoRouting.enableAutoRouting}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t.settingsAutoRouting.enableAutoRouting}
            onClick={handleToggle}
            disabled={isSaving}
            className={`${styles.toggleSwitch} ${enabled ? styles.toggleSwitchOn : ''}`}
          />
        </div>
      </section>

      <div className={styles.chainHeader}>
        <span className={styles.chainMeta}>
          {entries.length > 0
            ? t.settingsAutoRouting.providerCount.replace('{count}', String(entries.length))
            : enabled
              ? t.settingsAutoRouting.noEntries
              : ''}
        </span>
        <button type="button" onClick={handleAddEntry} className={styles.addButton}>
          <PlusIcon size={12} />
          {t.settingsAutoRouting.addEntry}
        </button>
      </div>

      {entries.length === 0 ? (
        enabled ? (
          <div className={styles.emptyState}>{t.settingsAutoRouting.noEntries}</div>
        ) : null
      ) : (
        <div className={styles.entryList}>
          {entries.map((entry, index) => (
            <EntryRow
              key={index}
              entry={entry}
              index={index}
              total={entries.length}
              profiles={profiles ?? ({} as AIProfiles)}
              onChange={handleEntryChange}
              onDelete={handleDeleteEntry}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
            />
          ))}
        </div>
      )}

      {(hasUnsavedChanges || entries.length > 0) && (
        <div className={styles.footer}>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={styles.saveButton}
          >
            {isSaving ? t.settingsAutoRouting.saving : t.settingsAutoRouting.saveConfig}
          </button>
          {hasUnsavedChanges && (
            <span className={styles.unsavedHint}>{t.settingsAutoRouting.unsavedChanges}</span>
          )}
        </div>
      )}
    </div>
  );
}
