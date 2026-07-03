import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../../i18n';
import type { CompactMetadata } from '../../types/chat';
import { markdownComponents } from './MarkdownRenderers';
import styles from './CompactBoundaryCard.module.css';

interface CompactBoundaryCardProps {
  metadata: CompactMetadata;
  summaryText?: string;
  variant?: 'boundary' | 'summary';
}

export default function CompactBoundaryCard({
  metadata,
  summaryText,
  variant = 'boundary',
}: CompactBoundaryCardProps) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const coveredCount = metadata.originalMessageIds.length;
  const timeLabel = new Date(metadata.compactedAt).toLocaleString();

  if (variant === 'summary' && summaryText) {
    return (
      <div className={styles.compactWrap}>
        <div className={styles.compactCard}>
          <div className={styles.compactHeader}>
            <span>{t.chat.contextCompactSummary}</span>
            <button
              type="button"
              className={styles.compactToggle}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t.actions.collapse : t.actions.expand}
            </button>
          </div>
          {expanded && (
            <div className={styles.summaryBody}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {summaryText}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.compactWrap}>
      <div className={styles.compactCard}>
        <div className={styles.compactHeader}>
          <span>
            {t.chat.contextCompactBoundary
              .replace('{time}', timeLabel)
              .replace('{count}', String(coveredCount))}
          </span>
          {summaryText && (
            <button
              type="button"
              className={styles.compactToggle}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t.actions.collapse : t.actions.expand}
            </button>
          )}
        </div>
        {expanded && summaryText && (
          <div className={styles.summaryBody}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {summaryText}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
