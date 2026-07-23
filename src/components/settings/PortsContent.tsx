import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import { showSuccess } from '../../utils/notification';
import {
  type ListeningPortEntry,
  type PortOwnership,
  getCachedListeningPorts,
  getProcessExecutablePath,
  killPortProcess,
  listListeningPorts,
  parsePortKillFailure,
} from '../../utils/portManager';
import { SettingsDeleteModal } from './SettingsDeleteModal';
import pageStyles from './SettingsPage.module.css';
import styles from './PortsContent.module.css';

type KillTarget = Pick<ListeningPortEntry, 'port' | 'pid' | 'processName' | 'commandLine'>;

function ownershipLabel(
  ownership: PortOwnership,
  labels: {
    loomManaged: string;
    knownExternal: string;
    external: string;
    protected: string;
  }
): string {
  switch (ownership) {
    case 'loomManaged':
      return labels.loomManaged;
    case 'knownExternal':
      return labels.knownExternal;
    case 'protected':
      return labels.protected;
    default:
      return labels.external;
  }
}

function resolveHintText(entry: ListeningPortEntry, hints: Record<string, string>): string {
  if (entry.hint.labelKey && hints[entry.hint.labelKey]) {
    return hints[entry.hint.labelKey];
  }
  return entry.hint.description ?? entry.processName;
}

function killDisabledReason(
  entry: ListeningPortEntry,
  reasons: {
    protected: string;
    loomManaged: string;
    cannotKill: string;
  }
): string {
  if (entry.ownership === 'protected') return reasons.protected;
  if (entry.ownership === 'loomManaged') return reasons.loomManaged;
  if (!entry.canKill) return reasons.cannotKill;
  return '';
}

function ProcessNameWithPath({
  processName,
  path,
  commandLine,
  pathUnavailableLabel,
}: {
  processName: string;
  path: string | null | undefined;
  commandLine?: string | null;
  pathUnavailableLabel: string;
}) {
  const title = (() => {
    if (path) return path;
    if (path === null) {
      // Fall back to command line when executable path is unavailable
      // (e.g. system processes, protected processes, or PID 0)
      if (commandLine && commandLine.trim().length > 0) {
        return commandLine.trim();
      }
      return pathUnavailableLabel;
    }
    return undefined;
  })();

  return (
    <span className={styles.processName} title={title}>
      {processName}
    </span>
  );
}

export function PortsContent() {
  const t = useTranslation();
  const { showError } = useNotification();
  const initialCache = getCachedListeningPorts();
  const [entries, setEntries] = useState<ListeningPortEntry[]>(initialCache ?? []);
  const [loading, setLoading] = useState(isTauri() && initialCache === null);
  const [query, setQuery] = useState('');
  const [killTarget, setKillTarget] = useState<KillTarget | null>(null);
  const [permissionDeniedTarget, setPermissionDeniedTarget] = useState<KillTarget | null>(null);
  const [killing, setKilling] = useState(false);
  const killingRef = useRef(false);
  const [processPaths, setProcessPaths] = useState<Map<number, string | null>>(new Map());

  const scan = useCallback(
    async (force: boolean) => {
      if (!isTauri()) return;
      setLoading(true);
      try {
        const result = await listListeningPorts({ force });
        setEntries(result);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : String(error) || t.settingsPorts.scanFailed
        );
      } finally {
        setLoading(false);
      }
    },
    [showError, t.settingsPorts.scanFailed]
  );

  useEffect(() => {
    if (!isTauri() || entries.length === 0) return;
    const pids = entries.map((e) => e.pid).filter((pid) => !processPaths.has(pid));
    if (pids.length === 0) return;

    let cancelled = false;
    const loadPaths = async () => {
      const results = await Promise.all(
        pids.map(async (pid) => {
          try {
            return { pid, path: await getProcessExecutablePath(pid) };
          } catch {
            return { pid, path: null };
          }
        })
      );
      if (cancelled) return;
      setProcessPaths((prev) => {
        const next = new Map(prev);
        for (const { pid, path } of results) {
          next.set(pid, path);
        }
        return next;
      });
    };
    void loadPaths();
    return () => {
      cancelled = true;
    };
  }, [entries, processPaths]);

  useEffect(() => {
    if (!isTauri() || getCachedListeningPorts() !== null) return;
    void scan(false);
  }, [scan]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      const hint = resolveHintText(entry, t.settingsPorts.hints);
      return (
        String(entry.port).includes(q) ||
        entry.processName.toLowerCase().includes(q) ||
        entry.pid.toString().includes(q) ||
        hint.toLowerCase().includes(q) ||
        (entry.commandLine?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, query, t.settingsPorts.hints]);

  const handleKillConfirm = async () => {
    if (!killTarget || killingRef.current) return;
    const target = killTarget;
    killingRef.current = true;
    setKilling(true);
    try {
      await killPortProcess(target.port, target.pid);
      showSuccess(t.settingsPorts.killSuccess);
      setKillTarget(null);
      setEntries(getCachedListeningPorts() ?? []);
    } catch (error) {
      const failure = parsePortKillFailure(error);
      if (failure.type === 'permission_denied') {
        setKillTarget(null);
        setPermissionDeniedTarget(target);
      } else {
        showError(failure.message || t.settingsPorts.killFailed);
      }
    } finally {
      killingRef.current = false;
      setKilling(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className={pageStyles.root}>
        <header className={pageStyles.pageHeader}>
          <h2 className={pageStyles.pageTitle}>{t.settingsPorts.title}</h2>
          <p className={pageStyles.pageDescription}>{t.settingsPorts.desktopOnly}</p>
        </header>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={pageStyles.pageHeader}>
        <div className={pageStyles.pageHeaderRow}>
          <div>
            <h2 className={pageStyles.pageTitle}>{t.settingsPorts.title}</h2>
            <p className={pageStyles.pageDescription}>{t.settingsPorts.description}</p>
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void scan(true)}
            disabled={loading}
          >
            {loading ? t.settingsPorts.scanning : t.settingsPorts.refresh}
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder={t.settingsPorts.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className={styles.countLabel}>
          {t.settingsPorts.portCount.replace('{count}', String(filteredEntries.length))}
        </span>
      </div>

      {loading && entries.length === 0 ? (
        <div className={pageStyles.loading}>{t.settingsPorts.scanning}</div>
      ) : filteredEntries.length === 0 ? (
        <div className={styles.emptyState}>{t.settingsPorts.empty}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.settingsPorts.columns.port}</th>
                <th>{t.settingsPorts.columns.address}</th>
                <th>{t.settingsPorts.columns.process}</th>
                <th>{t.settingsPorts.columns.hint}</th>
                <th>{t.settingsPorts.columns.tag}</th>
                <th>{t.settingsPorts.columns.action}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => {
                const disabledReason = killDisabledReason(entry, {
                  protected: t.settingsPorts.killDisabledProtected,
                  loomManaged: t.settingsPorts.killDisabledLoomManaged,
                  cannotKill: t.settingsPorts.killDisabledGeneric,
                });
                return (
                  <tr key={`${entry.port}-${entry.pid}-${entry.address}`}>
                    <td className={styles.portCell}>{entry.port}</td>
                    <td className={styles.monoCell}>{entry.address}</td>
                    <td className={styles.processCell}>
                      <ProcessNameWithPath
                        processName={entry.processName}
                        path={processPaths.get(entry.pid)}
                        commandLine={entry.commandLine}
                        pathUnavailableLabel={t.settingsPorts.pathUnavailable}
                      />
                      <span className={styles.pidLabel}>PID {entry.pid}</span>
                    </td>
                    <td className={styles.hintCell}>
                      {resolveHintText(entry, t.settingsPorts.hints)}
                      {entry.commandLine ? (
                        <span className={styles.commandLine} title={entry.commandLine}>
                          {entry.commandLine}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge_${entry.ownership}`]}`}>
                        {ownershipLabel(entry.ownership, t.settingsPorts.ownership)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.killButton}
                        disabled={!entry.canKill || killing}
                        title={disabledReason || undefined}
                        onClick={() =>
                          setKillTarget({
                            port: entry.port,
                            pid: entry.pid,
                            processName: entry.processName,
                            commandLine: entry.commandLine,
                          })
                        }
                      >
                        {t.settingsPorts.kill}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {permissionDeniedTarget ? (
        <div className={pageStyles.deleteModal} onClick={() => setPermissionDeniedTarget(null)}>
          <div
            className={`${pageStyles.deleteModalContent} ${styles.permissionModalContent}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.permissionModalTitle}>
              {t.settingsPorts.killPermissionDeniedTitle}
            </div>
            <p className={styles.permissionModalDescription}>
              {t.settingsPorts.killPermissionDeniedDescription}
            </p>
            <ul className={styles.confirmList}>
              <li>
                {t.settingsPorts.killConfirmPort}: {permissionDeniedTarget.port}
              </li>
              <li>
                {t.settingsPorts.killConfirmProcess}: {permissionDeniedTarget.processName}
              </li>
              <li>
                {t.settingsPorts.killConfirmPid}: {permissionDeniedTarget.pid}
              </li>
            </ul>
            <ul className={styles.permissionTips}>
              <li>{t.settingsPorts.killPermissionDeniedTipAdmin}</li>
              <li>{t.settingsPorts.killPermissionDeniedTipTaskManager}</li>
              <li>{t.settingsPorts.killPermissionDeniedTipService}</li>
            </ul>
            <div className={pageStyles.deleteModalButtons}>
              <button
                type="button"
                className={pageStyles.primaryButton}
                onClick={() => setPermissionDeniedTarget(null)}
              >
                {t.settingsPorts.killPermissionDeniedOk}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {killTarget ? (
        <SettingsDeleteModal
          title={t.settingsPorts.killConfirmTitle}
          confirmLabel={killing ? t.settingsPorts.killing : t.settingsPorts.kill}
          confirmDisabled={killing}
          cancelDisabled={killing}
          onCancel={() => setKillTarget(null)}
          onConfirm={() => void handleKillConfirm()}
        >
          <p>{t.settingsPorts.killConfirmBody}</p>
          <ul className={styles.confirmList}>
            <li>
              {t.settingsPorts.killConfirmPort}: {killTarget.port}
            </li>
            <li>
              {t.settingsPorts.killConfirmPid}: {killTarget.pid}
            </li>
            <li>
              {t.settingsPorts.killConfirmProcess}: {killTarget.processName}
            </li>
            {killTarget.commandLine ? (
              <li>
                {t.settingsPorts.killConfirmCommand}: {killTarget.commandLine}
              </li>
            ) : null}
          </ul>
        </SettingsDeleteModal>
      ) : null}
    </div>
  );
}
