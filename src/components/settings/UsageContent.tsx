import { type CSSProperties } from 'react';
import { useTranslation } from '../../i18n';
import { useEnableUsageTracking, useUpdateUsageTracking } from '../../stores';
import { useUsageStore, useUsageTotals, useUsageByModel } from '../../stores/useUsageStore';
import { useNotification } from '../../contexts/NotificationContext';
import pageStyles from './SettingsPage.module.css';
import { SettingsPanel, SettingsSection, SettingsRow, SettingsToggle } from './SettingsPrimitives';
import styles from './UsageContent.module.css';

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function UsageContent() {
  const t = useTranslation();
  const { showError } = useNotification();

  const total = useUsageTotals();
  const byModel = useUsageByModel();
  const sessions = useUsageStore((s) => s.sessions);
  const resetUsage = useUsageStore((s) => s.reset);

  const enableUsageTracking = useEnableUsageTracking();
  const updateUsageTracking = useUpdateUsageTracking();

  const sessionEntries = Object.entries(sessions).sort(
    (a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0),
  );
  const modelEntries = Object.entries(byModel).sort(
    (a, b) => b[1].inputTokens + b[1].outputTokens - (a[1].inputTokens + a[1].outputTokens),
  );

  const handleReset = async () => {
    if (!window.confirm(t.settingsUsage.resetConfirm)) return;
    try {
      resetUsage();
    } catch {
      showError(t.errors.updateFailed);
    }
  };

  const statItems = [
    {
      key: 'total',
      value: formatNumber(total.inputTokens + total.outputTokens),
      label: t.settingsUsage.totalTokens,
    },
    {
      key: 'input',
      value: formatNumber(total.inputTokens),
      label: t.settingsUsage.inputTokens,
    },
    {
      key: 'output',
      value: formatNumber(total.outputTokens),
      label: t.settingsUsage.outputTokens,
    },
    {
      key: 'cache',
      value: formatNumber(total.cacheReadTokens + total.cacheWriteTokens),
      label: t.settingsUsage.cacheTokens,
    },
  ] as const;

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsUsage.title}</h2>
      </header>

      <SettingsPanel>
        <SettingsSection
          title={t.settingsUsage.totalTokens}
          description={t.settingsUsage.description}
          action={
            <button type="button" className={styles.resetButton} onClick={handleReset}>
              {t.settingsUsage.reset}
            </button>
          }
        >
          <div className={styles.statGrid}>
            {statItems.map((item, index) => (
              <div
                key={item.key}
                className={styles.statCard}
                style={{ '--stat-index': index } as CSSProperties}
              >
                <div className={styles.statValue}>{item.value}</div>
                <div className={styles.statLabel}>{item.label}</div>
              </div>
            ))}
          </div>
          <SettingsRow
            label={t.settingsUsage.enableTracking}
            hint={t.settingsUsage.enableTrackingHint}
            control={
              <SettingsToggle
                checked={enableUsageTracking}
                ariaLabel={t.settingsUsage.enableTracking}
                onChange={(checked) => {
                  void updateUsageTracking(checked);
                }}
              />
            }
          />
        </SettingsSection>

        {sessionEntries.length > 0 && (
          <SettingsSection title={t.settingsUsage.perSession}>
            <div className={styles.list}>
              {sessionEntries.map(([id, entry]) => (
                <div className={styles.listRow} key={id}>
                  <span className={styles.listName} title={id}>
                    {id}
                  </span>
                  <span className={styles.listMeta}>
                    <span className={styles.metaLabel}>{t.settingsUsage.inputShort}</span>
                    {formatNumber(entry.inputTokens)} tok
                  </span>
                  <span className={styles.listMeta}>
                    <span className={styles.metaLabel}>{t.settingsUsage.outputShort}</span>
                    {formatNumber(entry.outputTokens)} tok
                  </span>
                </div>
              ))}
            </div>
          </SettingsSection>
        )}

        {modelEntries.length > 0 && (
          <SettingsSection title={t.settingsUsage.perModel}>
            <div className={styles.list}>
              {modelEntries.map(([key, entry]) => (
                <div className={styles.listRow} key={key}>
                  <span className={styles.listName} title={key}>
                    {key}
                  </span>
                  <span className={styles.listMeta}>
                    <span className={styles.metaLabel}>{t.settingsUsage.inputShort}</span>
                    {formatNumber(entry.inputTokens)} tok
                  </span>
                  <span className={styles.listMeta}>
                    <span className={styles.metaLabel}>{t.settingsUsage.outputShort}</span>
                    {formatNumber(entry.outputTokens)} tok
                  </span>
                </div>
              ))}
            </div>
          </SettingsSection>
        )}

        {sessionEntries.length === 0 && modelEntries.length === 0 && (
          <p className={styles.emptyState}>{t.settingsUsage.noData}</p>
        )}
      </SettingsPanel>
    </div>
  );
}
