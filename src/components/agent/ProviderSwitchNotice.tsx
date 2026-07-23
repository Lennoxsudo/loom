import type { ProviderSwitchNotice as ProviderSwitchNoticeData } from '../../types/chat';
import { useTranslation } from '../../i18n';
import styles from './ProviderSwitchNotice.module.css';

function shortModelName(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return model;
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function CubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 10v6M12 7h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export default function ProviderSwitchNotice({
  notice,
  variant = 'default',
}: {
  notice: ProviderSwitchNoticeData;
  variant?: 'default' | 'compact';
}) {
  const t = useTranslation();
  const isCompact = variant === 'compact';
  const fromLabel = isCompact ? shortModelName(notice.fromModel) : notice.fromModel;
  const toLabel = isCompact ? shortModelName(notice.toModel) : notice.toModel;
  const label = t.agent.modelSwitchedFromTo.replace('{from}', fromLabel).replace('{to}', toLabel);
  const detail = `${notice.fromProvider}/${notice.fromModel} -> ${notice.toProvider}/${notice.toModel}`;
  const iconSize = isCompact ? 10 : 14;

  if (isCompact) {
    return (
      <div className={styles.compactWrap} id="provider-switch-notice" title={detail}>
        <span className={styles.compactIcon}>
          <CubeIcon size={iconSize} />
        </span>
        <span className={styles.compactLabel}>{label}</span>
      </div>
    );
  }

  return (
    <div className={styles.wrap} id="provider-switch-notice">
      <div className={styles.line} aria-hidden="true" />
      <div className={styles.content} title={detail}>
        <span className={styles.icon}>
          <CubeIcon size={iconSize} />
        </span>
        <span className={styles.label}>{label}</span>
        <span className={styles.infoIcon}>
          <InfoIcon size={iconSize} />
        </span>
      </div>
      <div className={styles.line} aria-hidden="true" />
    </div>
  );
}
