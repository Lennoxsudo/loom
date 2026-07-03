import { useState, useEffect, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  useAgentAccessMode,
  useUpdateAgentAccessMode,
  useToolCallDelay,
  useUpdateToolCallDelay,
  useStreamSpeed,
  useUpdateStreamSpeed,
  useThinkingBlockAutoExpand,
  useUpdateThinkingBlockAutoExpand,
  useEnableSubagents,
  useUpdateEnableSubagents,
} from '../../stores';
import {
  showError as globalShowError,
  showSuccess as globalShowSuccess,
} from '../../utils/notification';
import { useTranslation } from '../../i18n';
import type { ToolCallDelay, StreamSpeed } from '../../types/settings';
import pageStyles from './SettingsPage.module.css';
import primitiveStyles from './SettingsPrimitives.module.css';
import panelStyles from './AgentSettingsView.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSelect,
  SettingsToggle,
} from './SettingsPrimitives';

type AccessMode = 'read_only' | 'auto' | 'full_access';

export type AgentSettingsSection = 'general' | 'behavior' | 'subagent';

export type AgentContentProps = {
  variant?: 'page' | 'panel';
  section?: AgentSettingsSection;
};

function PanelSettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className={panelStyles.settingRow}>
      <div className={panelStyles.settingRowText}>
        <div className={panelStyles.settingRowTitle}>{title}</div>
        {description ? <div className={panelStyles.settingRowDesc}>{description}</div> : null}
      </div>
      <div className={panelStyles.settingRowControl}>{control}</div>
    </div>
  );
}

export function AgentContent({ variant = 'page', section = 'general' }: AgentContentProps) {
  const t = useTranslation();
  const agentAccessMode = useAgentAccessMode();
  const updateAgentAccessMode = useUpdateAgentAccessMode();
  const toolCallDelay = useToolCallDelay();
  const updateToolCallDelay = useUpdateToolCallDelay();
  const streamSpeed = useStreamSpeed();
  const updateStreamSpeed = useUpdateStreamSpeed();
  const thinkingBlockAutoExpand = useThinkingBlockAutoExpand();
  const updateThinkingBlockAutoExpand = useUpdateThinkingBlockAutoExpand();
  const enableSubagents = useEnableSubagents();
  const updateEnableSubagents = useUpdateEnableSubagents();
  const [storagePath, setStoragePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const loadStoragePath = async () => {
      try {
        const path = await invoke<string>('get_agent_storage_path');
        setStoragePath(path);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.settingsAgent.errors.getPathFailed);
      } finally {
        setLoading(false);
      }
    };

    void loadStoragePath();
  }, [t.settingsAgent.errors.getPathFailed]);

  const withUpdate = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      globalShowError(t.errors.updateFailed);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(storagePath);
      globalShowSuccess(t.settingsAgent.pathCopied);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      globalShowError(t.common.copyFailed);
    }
  };

  const accessModeOptions = [
    {
      value: 'read_only' as const,
      label: t.settingsAgent.accessMode.readOnly,
      description: t.settingsAgent.accessMode.readOnlyBadge,
    },
    {
      value: 'auto' as const,
      label: t.settingsAgent.accessMode.auto,
      description: t.settingsAgent.accessMode.autoBadge,
    },
    {
      value: 'full_access' as const,
      label: t.settingsAgent.accessMode.fullAccess,
      description: t.settingsAgent.accessMode.fullAccessBadge,
    },
  ];

  const toolCallDelayOptions = [
    { value: '0', label: t.settingsAgent.toolCallDelay.noDelay },
    { value: '500', label: t.settingsAgent.toolCallDelay.ms500 },
    { value: '1000', label: t.settingsAgent.toolCallDelay.ms1000 },
    { value: '2000', label: t.settingsAgent.toolCallDelay.ms2000 },
    { value: '3000', label: t.settingsAgent.toolCallDelay.ms3000 },
    { value: '5000', label: t.settingsAgent.toolCallDelay.ms5000 },
  ];

  const streamSpeedOptions = [
    { value: 'fast', label: t.settingsAgent.streamSpeed.fast },
    { value: 'normal', label: t.settingsAgent.streamSpeed.normal },
    { value: 'slow', label: t.settingsAgent.streamSpeed.slow },
  ];

  const pageAccessModeOptions = accessModeOptions.map(({ value, label }) => ({ value, label }));
  const pageToolCallDelayOptions: { value: ToolCallDelay; label: string }[] = [
    { value: 0, label: t.settingsAgent.toolCallDelay.noDelay },
    { value: 500, label: t.settingsAgent.toolCallDelay.ms500 },
    { value: 1000, label: t.settingsAgent.toolCallDelay.ms1000 },
    { value: 2000, label: t.settingsAgent.toolCallDelay.ms2000 },
    { value: 3000, label: t.settingsAgent.toolCallDelay.ms3000 },
    { value: 5000, label: t.settingsAgent.toolCallDelay.ms5000 },
  ];
  const pageStreamSpeedOptions: { value: StreamSpeed; label: string }[] = [
    { value: 'fast', label: t.settingsAgent.streamSpeed.fast },
    { value: 'normal', label: t.settingsAgent.streamSpeed.normal },
    { value: 'slow', label: t.settingsAgent.streamSpeed.slow },
  ];

  const sectionTitle =
    section === 'general'
      ? t.settingsAgent.nav.general
      : section === 'behavior'
        ? t.settingsAgent.groups.behavior
        : t.settingsAgent.subagent.title;

  const renderStoragePath = (panel = false) => {
    if (loading) {
      return <div className={panel ? panelStyles.pathStatus : primitiveStyles.pathStatus}>{t.common.loading}</div>;
    }
    if (error) {
      return <div className={panel ? panelStyles.pathError : primitiveStyles.pathError}>{error}</div>;
    }

    if (panel) {
      return (
        <div className={panelStyles.pathBlock}>
          <div className={panelStyles.pathDisplay} title={storagePath}>
            {storagePath}
          </div>
          <button
            type="button"
            onClick={() => void copyToClipboard()}
            className={`${panelStyles.pathCopyButton} ${copied ? panelStyles.pathCopyButtonSuccess : ''}`}
          >
            {copied ? '✓' : t.settingsAgent.storagePath.copyPath}
          </button>
        </div>
      );
    }

    return (
      <div className={primitiveStyles.pathRow}>
        <div className={primitiveStyles.pathDisplay} title={storagePath}>
          {storagePath}
        </div>
        <button
          type="button"
          onClick={() => void copyToClipboard()}
          className={`${primitiveStyles.pathCopyButton} ${copied ? primitiveStyles.pathCopyButtonSuccess : ''}`}
        >
          {copied ? '✓' : t.settingsAgent.storagePath.copyPath}
        </button>
      </div>
    );
  };

  if (variant === 'panel') {
    return (
      <>
        <h2 className={panelStyles.contentTitle}>{sectionTitle}</h2>

        {section === 'general' && (
          <section className={panelStyles.block}>
            <h3 className={panelStyles.blockTitle}>{t.settingsAgent.storagePath.title}</h3>
            {renderStoragePath(true)}
          </section>
        )}

        {section === 'behavior' && (
          <>
            <section className={panelStyles.block}>
              <h3 className={panelStyles.blockTitle}>{t.settingsAgent.accessMode.title}</h3>
              <div className={panelStyles.choiceGrid} role="radiogroup" aria-label={t.settingsAgent.accessMode.title}>
                {accessModeOptions.map((option) => {
                  const active = agentAccessMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`${panelStyles.choiceCard} ${active ? panelStyles.choiceCardActive : ''}`}
                      onClick={() => withUpdate(() => updateAgentAccessMode(option.value))}
                    >
                      <span className={panelStyles.choiceCardBody}>
                        <span className={panelStyles.choiceCardTitle}>{option.label}</span>
                        <span className={panelStyles.choiceCardDesc}>{option.description}</span>
                      </span>
                      <span className={panelStyles.choiceRadio} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={panelStyles.block}>
              <PanelSettingRow
                title={t.settingsAgent.streamSpeed.title}
                description={t.settingsAgent.streamSpeed.description}
                control={
                  <SettingsSelect
                    value={streamSpeed}
                    options={streamSpeedOptions}
                    onChange={(value) => withUpdate(() => updateStreamSpeed(value as StreamSpeed))}
                  />
                }
              />
              <PanelSettingRow
                title={t.settingsAgent.toolCallDelay.title}
                description={t.settingsAgent.toolCallDelay.description}
                control={
                  <SettingsSelect
                    value={String(toolCallDelay)}
                    options={toolCallDelayOptions}
                    onChange={(value) =>
                      withUpdate(() => updateToolCallDelay(Number(value) as ToolCallDelay))
                    }
                  />
                }
              />
              <PanelSettingRow
                title={t.settingsAgent.thinkingBlockAutoExpand.title}
                description={t.settingsAgent.thinkingBlockAutoExpand.description}
                control={
                  <SettingsToggle
                    checked={thinkingBlockAutoExpand}
                    ariaLabel={t.settingsAgent.thinkingBlockAutoExpand.title}
                    onChange={(enabled) => withUpdate(() => updateThinkingBlockAutoExpand(enabled))}
                  />
                }
              />
            </section>
          </>
        )}

        {section === 'subagent' && (
          <section className={panelStyles.block}>
            <PanelSettingRow
              title={t.settingsAgent.enableSubagents.title}
              description={t.settingsAgent.enableSubagents.description}
              control={
                <SettingsToggle
                  checked={enableSubagents}
                  ariaLabel={t.settingsAgent.enableSubagents.title}
                  onChange={(enabled) => withUpdate(() => updateEnableSubagents(enabled))}
                />
              }
            />
          </section>
        )}
      </>
    );
  }

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsAgent.title}</h2>
      </header>

      <SettingsPanel>
        <SettingsSection title={t.settingsAgent.storagePath.title}>
          <SettingsBlockBody>{renderStoragePath(false)}</SettingsBlockBody>
        </SettingsSection>

        <SettingsSection title={t.settingsAgent.groups.behavior}>
          <SettingsRow
            label={t.settingsAgent.accessMode.title}
            hint={t.settingsAgent.accessMode.description}
            control={
              <SettingsSegmented<AccessMode>
                value={agentAccessMode}
                options={pageAccessModeOptions}
                onChange={(mode) => withUpdate(() => updateAgentAccessMode(mode))}
              />
            }
          />
          <SettingsRow
            label={t.settingsAgent.streamSpeed.title}
            hint={t.settingsAgent.streamSpeed.description}
            control={
              <SettingsSegmented<StreamSpeed>
                value={streamSpeed}
                options={pageStreamSpeedOptions}
                onChange={(speed) => withUpdate(() => updateStreamSpeed(speed))}
              />
            }
          />
          <SettingsRow
            label={t.settingsAgent.toolCallDelay.title}
            hint={t.settingsAgent.toolCallDelay.description}
            control={
              <SettingsSegmented<ToolCallDelay>
                value={toolCallDelay}
                options={pageToolCallDelayOptions}
                onChange={(delay) => withUpdate(() => updateToolCallDelay(delay))}
              />
            }
          />
          <SettingsRow
            label={t.settingsAgent.thinkingBlockAutoExpand.title}
            hint={t.settingsAgent.thinkingBlockAutoExpand.description}
            control={
              <SettingsToggle
                checked={thinkingBlockAutoExpand}
                ariaLabel={t.settingsAgent.thinkingBlockAutoExpand.title}
                onChange={(enabled) => withUpdate(() => updateThinkingBlockAutoExpand(enabled))}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={t.settingsAgent.subagent.title}>
          <SettingsRow
            label={t.settingsAgent.enableSubagents.title}
            hint={t.settingsAgent.enableSubagents.description}
            control={
              <SettingsToggle
                checked={enableSubagents}
                ariaLabel={t.settingsAgent.enableSubagents.title}
                onChange={(enabled) => withUpdate(() => updateEnableSubagents(enabled))}
              />
            }
          />
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
