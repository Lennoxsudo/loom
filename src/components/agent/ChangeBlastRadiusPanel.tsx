import { memo } from 'react';
import { useTranslation } from '../../i18n';
import type { BlastRadiusResult } from '../../utils/changeBlastRadius';
import { getShortFileName } from './utils';
import styles from './ChangeReviewPanel.module.css';

export interface ChangeBlastRadiusPanelProps {
  result: BlastRadiusResult | null;
  error: string | null;
  loading: boolean;
}

const ChangeBlastRadiusPanel = memo(function ChangeBlastRadiusPanel({
  result,
  error,
  loading,
}: ChangeBlastRadiusPanelProps) {
  const t = useTranslation();
  const cr = t.agent.changeReview;

  if (loading && !result) {
    return <div className={styles.empty}>{cr.viewImpactLoading}</div>;
  }

  if (error && !result?.symbols.length) {
    return (
      <div className={styles.empty} data-testid="blast-radius-error">
        {cr.impactError.replace('{error}', error)}
      </div>
    );
  }

  if (!result || result.empty) {
    return (
      <div className={styles.empty} data-testid="blast-radius-empty">
        {cr.impactEmpty}
      </div>
    );
  }

  return (
    <div className={styles.blastBody} data-testid="blast-radius-panel">
      <div className={styles.blastFileHint} title={result.filePath}>
        {getShortFileName(result.filePath)}
      </div>
      {result.symbols.map((sym) => (
        <div
          key={sym.symbol}
          className={`${styles.blastSymbolBlock} ${sym.highRisk ? styles.blastHighRiskBlock : ''}`}
          data-testid="blast-radius-symbol"
          data-high-risk={sym.highRisk ? 'true' : 'false'}
        >
          <div className={styles.blastSymbolHeader}>
            <code className={styles.blastSymbolName}>{sym.symbol}</code>
            {sym.highRisk ? (
              <span className={styles.blastHighRiskBadge}>{cr.impactHighRisk}</span>
            ) : null}
            <span className={styles.blastCallerCount}>
              {cr.impactCallers.replace('{count}', String(sym.callers.length))}
            </span>
          </div>
          {sym.callers.length === 0 ? (
            <div className={styles.blastNoCallers}>—</div>
          ) : (
            <ul className={styles.blastCallerList}>
              {sym.callers.map((caller, index) => (
                <li
                  key={`${caller.name}-${caller.file ?? ''}-${caller.line ?? index}`}
                  className={sym.highRisk ? styles.blastCallerHighRisk : undefined}
                >
                  <code>{caller.name}</code>
                  {caller.file ? (
                    <span className={styles.blastCallerMeta}>
                      {getShortFileName(caller.file)}
                      {caller.line != null ? `:${caller.line}` : ''}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
});

export default ChangeBlastRadiusPanel;
