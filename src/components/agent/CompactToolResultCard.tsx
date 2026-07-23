import { memo, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { TOOL_RESULT_WIDTH } from './toolResultLayout';
import { parsePlanToolOutput, resolveCompactToolLabel } from './compactToolResult';
import { formatToolDisplayName } from './toolResultLayout';
import styles from './CompactToolResultCard.module.css';

export interface CompactToolResultCardProps {
  toolName?: string;
  text: string;
  isError: boolean;
}

const PLAN_TOOLS = new Set(['update_plan', 'exit_plan_mode']);

const CompactToolResultCard = memo(function CompactToolResultCard({
  toolName,
  text,
  isError,
}: CompactToolResultCardProps) {
  const t = useTranslation();
  const labels = t.compactToolResult;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayName = useMemo(
    () => resolveCompactToolLabel(toolName, labels.tools, formatToolDisplayName(toolName)),
    [toolName, labels.tools]
  );

  const planMeta = useMemo(
    () => (toolName && PLAN_TOOLS.has(toolName) ? parsePlanToolOutput(text) : null),
    [toolName, text]
  );

  const hasBody = Boolean(text.trim());
  const statusLabel = isError ? t.common.failed : t.common.completed;
  const truncatedText = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;

  return (
    <div style={TOOL_RESULT_WIDTH}>
      <div className={`${styles.card} ${isError ? styles.cardError : ''}`}>
        <button
          type="button"
          className={styles.header}
          onClick={() => hasBody && setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          disabled={!hasBody}
        >
          <div className={styles.headerMain}>
            <span className={styles.toolName}>{displayName}</span>
            {planMeta?.title && <span className={styles.meta}>{planMeta.title}</span>}
            <span className={styles.statusPill}>{statusLabel}</span>
          </div>
          {hasBody && (
            <span
              className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
              aria-hidden
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          )}
        </button>

        {hasBody && (
          <div
            className={`${styles.panel} ${isExpanded ? styles.panelExpanded : ''}`}
            aria-hidden={!isExpanded}
          >
            <div className={`${styles.panelInner} ${isExpanded ? styles.panelInnerExpanded : ''}`}>
              {planMeta ? (
                <div className={styles.specRows}>
                  {planMeta.lead && <p className={styles.body}>{planMeta.lead}</p>}
                  {planMeta.title && (
                    <div className={styles.specRow}>
                      <span className={styles.specLabel}>{labels.planTitle}</span>
                      <span className={styles.specValue}>{planMeta.title}</span>
                    </div>
                  )}
                  {planMeta.length && (
                    <div className={styles.specRow}>
                      <span className={styles.specLabel}>{labels.planLength}</span>
                      <span className={styles.specValue}>{planMeta.length}</span>
                    </div>
                  )}
                </div>
              ) : (
                <pre className={styles.body}>{truncatedText}</pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default CompactToolResultCard;
