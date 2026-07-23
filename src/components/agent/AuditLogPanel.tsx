import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import styles from './AuditLogPanel.module.css';

/** A single audit log entry returned by the backend. */
interface AuditEntry {
  timestamp: string;
  source: string;
  action: string;
  target: string;
  decision: string;
  reason?: string;
  accessMode: string;
  /** Phase 2: optional correlation fields */
  sessionId?: string;
  executionId?: string;
  toolName?: string;
}

const REFRESH_INTERVAL_MS = 3000;
const MAX_DISPLAY = 200;

/** Format an ISO 8601 timestamp into a short local time string. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Truncate a string to `max` chars, appending an ellipsis if needed. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

const ACTION_LABELS: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  command: 'Command',
  command_cwd: 'CWD',
  network: 'Network',
  dangerous_command: 'Dangerous',
  restore: 'Restore',
};

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'denied' | 'allowed'>('all');

  const fetchEntries = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const [logs, total] = await Promise.all([
        invoke<AuditEntry[]>('get_audit_logs', { limit: MAX_DISPLAY }),
        invoke<number>('audit_log_count'),
      ]);
      setEntries(logs);
      setCount(total);
    } catch {
      // silently ignore — panel is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
    const timer = setInterval(() => void fetchEntries(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchEntries]);

  const handleClear = async () => {
    if (!isTauri()) return;
    try {
      await invoke('clear_audit_logs');
      await fetchEntries();
    } catch {
      // ignore
    }
  };

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.decision === filter);

  return (
    <div className={styles.container} data-testid="audit-log-panel">
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <span className={styles.countBadge}>{count}</span>
          <span className={styles.headerLabel}>
            {count === 1 ? 'entry' : 'entries'} (max {MAX_DISPLAY} shown)
          </span>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.filterGroup}>
            {(['all', 'denied', 'allowed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.filterBtn} ${filter === f ? styles.filterBtnActive : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'denied' ? 'Denied' : 'Allowed'}
              </button>
            ))}
          </div>
          <button type="button" className={styles.refreshBtn} onClick={() => void fetchEntries()}>
            ↻
          </button>
          <button type="button" className={styles.clearBtn} onClick={() => void handleClear()}>
            Clear
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>No audit entries yet</div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className={`${styles.row} ${entry.decision === 'denied' ? styles.rowDenied : styles.rowAllowed}`}
            >
              <span className={styles.time}>{formatTime(entry.timestamp)}</span>
              <span
                className={`${styles.badge} ${
                  entry.source === 'ai' ? styles.badgeAi : styles.badgeUser
                }`}
              >
                {entry.source === 'ai' ? 'AI' : 'USER'}
              </span>
              <span className={styles.action}>{ACTION_LABELS[entry.action] ?? entry.action}</span>
              <span className={styles.target} title={entry.target}>
                {truncate(entry.target || '—', 60)}
              </span>
              <span
                className={`${styles.decision} ${
                  entry.decision === 'denied' ? styles.decisionDenied : styles.decisionAllowed
                }`}
              >
                {entry.decision === 'denied' ? '✕ DENIED' : '✓ OK'}
              </span>
              {entry.reason ? (
                <span className={styles.reason} title={entry.reason}>
                  {truncate(entry.reason, 50)}
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AuditLogPanel;
