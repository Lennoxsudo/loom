import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from '../../i18n';
import { useEnableUsageTracking, useUpdateUsageTracking } from '../../stores';
import { useUsageStore, useUsageTotals, useUsageByModel } from '../../stores/useUsageStore';
import { useNotification } from '../../contexts/NotificationContext';
import pageStyles from './SettingsPage.module.css';
import { SettingsPanel, SettingsSection, SettingsRow, SettingsToggle } from './SettingsPrimitives';
import { SettingsDeleteModal } from './SettingsDeleteModal';
import styles from './UsageContent.module.css';

const PAGE_SIZE = 20;

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.min(Math.max(1, page), totalPages);
}

function UsagePagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
  prevLabel,
  nextLabel,
  pageLabel,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  prevLabel: string;
  nextLabel: string;
  pageLabel: string;
}) {
  if (totalItems <= PAGE_SIZE) return null;

  return (
    <div className={styles.pagination}>
      <span className={styles.paginationInfo}>
        {pageLabel
          .replace('{page}', String(page))
          .replace('{totalPages}', String(totalPages))
          .replace('{total}', String(totalItems))}
      </span>
      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.pageButton}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {prevLabel}
        </button>
        <button
          type="button"
          className={styles.pageButton}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

export function UsageContent() {
  const t = useTranslation();
  const { showError } = useNotification();

  const total = useUsageTotals();
  const byModel = useUsageByModel();
  const sessions = useUsageStore((s) => s.sessions);
  const resetUsage = useUsageStore((s) => s.reset);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [sessionPage, setSessionPage] = useState(1);
  const [modelPage, setModelPage] = useState(1);

  const enableUsageTracking = useEnableUsageTracking();
  const updateUsageTracking = useUpdateUsageTracking();

  const sessionEntries = useMemo(
    () =>
      Object.entries(sessions).sort(
        (a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0),
      ),
    [sessions],
  );
  const modelEntries = useMemo(
    () =>
      Object.entries(byModel).sort(
        (a, b) =>
          b[1].inputTokens + b[1].outputTokens - (a[1].inputTokens + a[1].outputTokens),
      ),
    [byModel],
  );

  const sessionTotalPages = Math.max(1, Math.ceil(sessionEntries.length / PAGE_SIZE));
  const modelTotalPages = Math.max(1, Math.ceil(modelEntries.length / PAGE_SIZE));

  useEffect(() => {
    setSessionPage((page) => clampPage(page, sessionTotalPages));
  }, [sessionTotalPages]);

  useEffect(() => {
    setModelPage((page) => clampPage(page, modelTotalPages));
  }, [modelTotalPages]);

  const pagedSessions = sessionEntries.slice(
    (sessionPage - 1) * PAGE_SIZE,
    sessionPage * PAGE_SIZE,
  );
  const pagedModels = modelEntries.slice((modelPage - 1) * PAGE_SIZE, modelPage * PAGE_SIZE);

  const handleReset = () => {
    try {
      resetUsage();
      setConfirmingReset(false);
      setSessionPage(1);
      setModelPage(1);
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
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => setConfirmingReset(true)}
            >
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
              {pagedSessions.map(([id, entry]) => (
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
            <UsagePagination
              page={sessionPage}
              totalPages={sessionTotalPages}
              totalItems={sessionEntries.length}
              onPageChange={setSessionPage}
              prevLabel={t.settingsUsage.prevPage}
              nextLabel={t.settingsUsage.nextPage}
              pageLabel={t.settingsUsage.pageInfo}
            />
          </SettingsSection>
        )}

        {modelEntries.length > 0 && (
          <SettingsSection title={t.settingsUsage.perModel}>
            <div className={styles.list}>
              {pagedModels.map(([key, entry]) => (
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
            <UsagePagination
              page={modelPage}
              totalPages={modelTotalPages}
              totalItems={modelEntries.length}
              onPageChange={setModelPage}
              prevLabel={t.settingsUsage.prevPage}
              nextLabel={t.settingsUsage.nextPage}
              pageLabel={t.settingsUsage.pageInfo}
            />
          </SettingsSection>
        )}

        {sessionEntries.length === 0 && modelEntries.length === 0 && (
          <p className={styles.emptyState}>{t.settingsUsage.noData}</p>
        )}
      </SettingsPanel>

      {confirmingReset && (
        <SettingsDeleteModal
          title={t.settingsUsage.reset}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={handleReset}
          confirmLabel={t.actions.confirm}
        >
          {t.settingsUsage.resetConfirm}
        </SettingsDeleteModal>
      )}
    </div>
  );
}
