import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import {
  useBuiltinGatewayState,
  useBuiltinGatewayStore,
} from '../../stores/useBuiltinGatewayStore';
import pageStyles from './SettingsPage.module.css';
import styles from './BuiltinGatewayContent.module.css';

const QUOTA_POLL_MS = 30_000;

export function BuiltinGatewayContent() {
  const t = useTranslation();
  const { showError, showSuccess } = useNotification();
  const {
    status,
    error,
    activatedAt,
    lastQuotas,
    quotaStatus,
    healthy,
    hydrated,
    apiKeyPresent,
  } = useBuiltinGatewayState();
  const hydrate = useBuiltinGatewayStore((s) => s.hydrate);
  const activate = useBuiltinGatewayStore((s) => s.activate);
  const clearLocalKey = useBuiltinGatewayStore((s) => s.clearLocalKey);
  const refreshHealth = useBuiltinGatewayStore((s) => s.refreshHealth);
  const refreshModels = useBuiltinGatewayStore((s) => s.refreshModels);
  const refreshQuota = useBuiltinGatewayStore((s) => s.refreshQuota);

  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // On settings mount / when activated: fetch quota immediately and every 30s.
  useEffect(() => {
    if (!apiKeyPresent || status === 'desktopOnly') return;
    void refreshQuota();
    void refreshHealth();
    const timer = window.setInterval(() => {
      void refreshQuota();
      void refreshHealth();
    }, QUOTA_POLL_MS);
    return () => window.clearInterval(timer);
  }, [apiKeyPresent, status, refreshQuota, refreshHealth]);

  const onActivate = async () => {
    if (!inviteCode.trim()) {
      showError(t.settingsBuiltin.inviteRequired);
      return;
    }
    setBusy(true);
    try {
      const ok = await activate(inviteCode.trim());
      if (ok) {
        showSuccess(t.settingsBuiltin.activateSuccess);
        setInviteCode('');
        void refreshHealth();
      } else {
        const err = useBuiltinGatewayStore.getState().error;
        showError(err === 'UNAUTHORIZED' ? t.settingsBuiltin.unauthorized : err || t.settingsBuiltin.activateFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await clearLocalKey();
      showSuccess(t.settingsBuiltin.cleared);
    } finally {
      setBusy(false);
    }
  };

  const onHealth = async () => {
    setBusy(true);
    try {
      await refreshHealth();
      const ok = useBuiltinGatewayStore.getState().healthy;
      if (ok) showSuccess(t.settingsBuiltin.healthOk);
      else showError(t.settingsBuiltin.healthFail);
    } finally {
      setBusy(false);
    }
  };

  const onRefreshModels = async () => {
    setBusy(true);
    try {
      const models = await refreshModels();
      if (useBuiltinGatewayStore.getState().error === 'UNAUTHORIZED') {
        showError(t.settingsBuiltin.unauthorized);
      } else if (models.length > 0) {
        showSuccess(t.settingsBuiltin.modelsLoaded.replace('{count}', String(models.length)));
      } else {
        showError(t.settingsBuiltin.modelsFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (() => {
    if (!hydrated || status === 'loading') return t.settingsBuiltin.statusLoading;
    if (status === 'desktopOnly') return t.settingsBuiltin.desktopOnly;
    if (status === 'activating') return t.settingsBuiltin.statusActivating;
    if (status === 'active' && apiKeyPresent) return t.settingsBuiltin.statusActive;
    if (status === 'error' && error === 'UNAUTHORIZED') return t.settingsBuiltin.unauthorized;
    if (status === 'error') return error || t.settingsBuiltin.statusError;
    return t.settingsBuiltin.statusInactive;
  })();

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <div className={pageStyles.pageHeaderRow}>
          <h1 className={pageStyles.pageTitle}>{t.settingsBuiltin.title}</h1>
        </div>
        <p className={pageStyles.pageDescription}>{t.settingsBuiltin.description}</p>
      </header>

      <section className={styles.card}>
        <div className={styles.row}>
          <span className={styles.label}>{t.settingsBuiltin.status}</span>
          <span className={styles.value}>{statusLabel}</span>
        </div>
        {apiKeyPresent && activatedAt && (
          <div className={styles.row}>
            <span className={styles.label}>{t.settingsBuiltin.activatedAt}</span>
            <span className={styles.value}>{new Date(activatedAt).toLocaleString()}</span>
          </div>
        )}
        {apiKeyPresent && (quotaStatus || lastQuotas) && (
          <div className={styles.row}>
            <span className={styles.label}>{t.settingsBuiltin.quotas}</span>
            <span className={styles.value}>
              {(() => {
                if (quotaStatus) {
                  const used = quotaStatus.usage.daily_requests;
                  const limit = quotaStatus.quotas.daily_requests;
                  const rem = quotaStatus.remaining.daily_requests;
                  const limitLabel = limit > 0 ? String(limit) : '∞';
                  const remLabel = rem === null ? '∞' : String(rem);
                  return t.settingsBuiltin.quotaDailyDetail
                    .replace('{used}', String(used))
                    .replace('{limit}', limitLabel)
                    .replace('{remaining}', remLabel);
                }
                // Fallback: activate-time limits only (no live usage yet)
                const limit = lastQuotas?.daily_requests ?? 0;
                return t.settingsBuiltin.quotaDailyDetail
                  .replace('{used}', '—')
                  .replace('{limit}', limit > 0 ? String(limit) : '∞')
                  .replace('{remaining}', limit > 0 ? String(limit) : '∞');
              })()}
            </span>
          </div>
        )}
        {healthy !== null && (
          <div className={styles.row}>
            <span className={styles.label}>{t.settingsBuiltin.health}</span>
            <span className={styles.value}>
              {healthy ? t.settingsBuiltin.healthOk : t.settingsBuiltin.healthFail}
            </span>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>{t.settingsBuiltin.activateSection}</h2>
        <p className={styles.hint}>{t.settingsBuiltin.activateHint}</p>
        <div className={styles.formRow}>
          <input
            className={styles.input}
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder={t.settingsBuiltin.invitePlaceholder}
            disabled={busy || status === 'desktopOnly'}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void onActivate()}
            disabled={busy || status === 'desktopOnly'}
          >
            {apiKeyPresent ? t.settingsBuiltin.reactivate : t.settingsBuiltin.activate}
          </button>
        </div>
      </section>

      <section className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void onHealth()}
          disabled={busy || status === 'desktopOnly'}
        >
          {t.settingsBuiltin.checkHealth}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void onRefreshModels()}
          disabled={busy || !apiKeyPresent}
        >
          {t.settingsBuiltin.refreshModels}
        </button>
        <button
          type="button"
          className={styles.dangerBtn}
          onClick={() => void onClear()}
          disabled={busy || !apiKeyPresent}
        >
          {t.settingsBuiltin.clearKey}
        </button>
      </section>
    </div>
  );
}

export default BuiltinGatewayContent;
