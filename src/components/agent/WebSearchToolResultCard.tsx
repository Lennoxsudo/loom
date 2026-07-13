import { openUrl } from '@tauri-apps/plugin-opener';
import { memo, useMemo, type CSSProperties } from 'react';
import { useTranslation } from '../../i18n';
import type { ChatMessage } from '../../types/chat';
import { TOOL_RESULT_WIDTH } from './toolResultLayout';
import {
  formatResultUrl,
  parseWebSearchToolResult,
} from './webSearchToolResult';
import styles from './WebSearchToolResultCard.module.css';

interface WebSearchToolResultCardProps {
  message: ChatMessage;
}

const WebSearchToolResultCard = memo(function WebSearchToolResultCard({
  message,
}: WebSearchToolResultCardProps) {
  const t = useTranslation();
  const labels = t.webSearchToolResult;

  const view = useMemo(
    () => parseWebSearchToolResult(message.text || '', message.isError === true),
    [message.text, message.isError],
  );

  const args = (message.tool_args || {}) as Record<string, unknown>;
  const queryFromArgs = typeof args.query === 'string' ? args.query.trim() : '';
  const displayQuery = view.query || queryFromArgs;

  const statusLabel = view.isError
    ? t.common.failed
    : labels.resultsCount.replace('{count}', String(view.count));

  const footerHint = view.hint || labels.fetchHint;

  const handleOpenUrl = async (url: string) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      // Ignore opener failures; URL remains visible for copy.
    }
  };

  return (
    <div style={TOOL_RESULT_WIDTH}>
      <div className={`${styles.card} ${view.isError ? styles.cardError : ''}`}>
        <div className={styles.headerBar}>
          <span className={styles.category}>{labels.category}</span>
          <div className={styles.headerMeta}>
            <span
              className={`${styles.countPill} ${view.isError ? styles.countPillError : ''}`}
            >
              {statusLabel}
            </span>
            {!view.isError && view.provider && (
              <span className={styles.providerChip}>
                {labels.provider.replace('{provider}', view.provider)}
              </span>
            )}
          </div>
        </div>

        {displayQuery && !view.isError && (
          <div className={styles.queryBar}>
            <span className={styles.queryText}>{displayQuery}</span>
          </div>
        )}

        {view.isError ? (
          <span className={styles.errorText}>{view.errorText || message.text}</span>
        ) : view.results.length > 0 ? (
          <div className={styles.results}>
            {view.results.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                className={styles.resultItem}
                style={{ '--index': index } as CSSProperties}
                onClick={() => void handleOpenUrl(item.url)}
                aria-label={labels.openLink.replace('{url}', item.url || item.title)}
                title={item.url}
              >
                <span className={styles.resultTitle}>{item.title}</span>
                {item.url && (
                  <span className={styles.resultMeta}>{formatResultUrl(item.url)}</span>
                )}
                {item.snippet && (
                  <p className={styles.snippet}>{item.snippet}</p>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            {view.emptyMessage || labels.empty}
          </div>
        )}

        {!view.isError && footerHint && (
          <div className={styles.footerHint}>{footerHint}</div>
        )}
      </div>
    </div>
  );
});

export default WebSearchToolResultCard;
