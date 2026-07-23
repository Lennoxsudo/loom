import { memo, useState } from 'react';
import type { GraphToolResultViewModel } from './types';
import styles from './GraphToolResultView.module.css';

const PREVIEW_ROW_LIMIT = 5;

export interface GraphToolResultLabels {
  category: string;
  completed: string;
  failed: string;
  empty: string;
  moreRows: (count: number) => string;
  toolLabel: (tool: string) => string;
  actionLabel: (action: string) => string;
}

interface GraphToolResultViewProps {
  view: GraphToolResultViewModel;
  labels: GraphToolResultLabels;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <span
      className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
      aria-hidden="true"
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
  );
}

function truncate(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const GraphToolResultView = memo(function GraphToolResultView({
  view,
  labels,
}: GraphToolResultViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasExpandable = Boolean(
    view.table ||
    view.codeBlock ||
    (view.sections && view.sections.length > 0) ||
    view.rawBody ||
    (view.stats && view.stats.length > 0) ||
    view.panelMeta
  );

  const actionLabel = labels.actionLabel(view.action);
  const detailText = view.isError ? labels.failed : view.isEmpty ? labels.empty : view.summary;

  const showDetail = Boolean(
    detailText &&
    detailText.toLowerCase() !== actionLabel.toLowerCase() &&
    detailText.toLowerCase() !== view.action.toLowerCase()
  );

  const previewRows = view.table?.rows.slice(0, PREVIEW_ROW_LIMIT) ?? [];
  const hiddenRowCount = view.table ? Math.max(0, view.table.total - previewRows.length) : 0;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.header}
        onClick={() => hasExpandable && setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        disabled={!hasExpandable}
      >
        <span className={styles.summary}>
          <span className={styles.summaryStrong}>{actionLabel}</span>
          {showDetail && (
            <>
              {' · '}
              <span className={view.isEmpty ? styles.summaryMuted : undefined}>{detailText}</span>
            </>
          )}
          {!view.isError && !showDetail && !view.isEmpty && (
            <>
              {' · '}
              <span className={styles.summaryOk}>✓</span>
            </>
          )}
          {view.isError && (
            <>
              {' · '}
              <span className={styles.summaryError}>✘</span>
            </>
          )}
        </span>

        {hasExpandable && <ChevronIcon expanded={isExpanded} />}
      </button>

      {hasExpandable && (
        <div
          className={`${styles.panel} ${isExpanded ? styles.panelExpanded : ''}`}
          aria-hidden={!isExpanded}
        >
          <div className={`${styles.panelInner} ${isExpanded ? styles.panelInnerExpanded : ''}`}>
            {view.panelMeta && (
              <div className={styles.panelMeta}>{truncate(view.panelMeta, 120)}</div>
            )}

            {view.stats && view.stats.length > 0 && (
              <div className={styles.stats}>
                {view.stats.map((stat) => (
                  <span key={stat.label} className={styles.statItem}>
                    <span>{stat.label}</span>
                    <span className={styles.statValue}>{stat.value}</span>
                  </span>
                ))}
              </div>
            )}

            {view.table && (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {view.table.headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, rowIdx) => (
                        <tr key={`row-${rowIdx}`}>
                          {row.map((cell, cellIdx) => (
                            <td key={`${rowIdx}-${cellIdx}`}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hiddenRowCount > 0 && (
                  <div className={styles.moreRows}>{labels.moreRows(hiddenRowCount)}</div>
                )}
              </>
            )}

            {view.codeBlock && (
              <>
                <div className={styles.codeHeader}>
                  {view.codeBlock.file && (
                    <span className={styles.codeFile}>{view.codeBlock.file}</span>
                  )}
                  {view.codeBlock.range && <span>{view.codeBlock.range}</span>}
                  {view.codeBlock.qualifiedName && <span>{view.codeBlock.qualifiedName}</span>}
                </div>
                <pre className={styles.codeBlock}>{view.codeBlock.code}</pre>
              </>
            )}

            {view.sections?.map((section) => (
              <div key={section.title} className={styles.section}>
                <div className={styles.sectionTitle}>{section.title}</div>
                <ul className={styles.sectionList}>
                  {section.items.map((item, idx) => (
                    <li key={`${section.title}-${idx}`} className={styles.sectionItem}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {view.rawBody && (
              <pre className={`${styles.rawBody} ${view.isError ? styles.rawBodyError : ''}`}>
                {view.rawBody}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
