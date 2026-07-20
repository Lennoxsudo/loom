import { memo, type ReactNode } from 'react';
import styles from './ToolActivityRow.module.css';

export type ToolActivityStatus = 'ok' | 'error' | 'run' | 'neutral';

export type ToolActivityMetaItem =
  | { kind: 'text'; value: string; tone?: 'default' | 'exit' | 'add' | 'del' }
  | { kind: 'sep' };

export interface ToolActivityRowProps {
  verb: string;
  main: ReactNode;
  meta?: ToolActivityMetaItem[];
  status?: ToolActivityStatus;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  detail?: ReactNode;
  className?: string;
  title?: string;
}

function statusClass(status: ToolActivityStatus | undefined): string {
  if (status === 'ok') return styles.isOk;
  if (status === 'error') return styles.isError;
  if (status === 'run') return styles.isRun;
  return '';
}

function MetaItems({ items }: { items: ToolActivityMetaItem[] }) {
  return (
    <>
      {items.map((item, index) => {
        if (item.kind === 'sep') {
          return <span key={`sep-${index}`} className={styles.metaSep} aria-hidden="true" />;
        }
        if (item.tone === 'exit') {
          return (
            <span key={`m-${index}`} className={styles.metaExit}>
              {item.value}
            </span>
          );
        }
        if (item.tone === 'add') {
          return (
            <span key={`m-${index}`} className={styles.add}>
              {item.value}
            </span>
          );
        }
        if (item.tone === 'del') {
          return (
            <span key={`m-${index}`} className={styles.del}>
              {item.value}
            </span>
          );
        }
        return <span key={`m-${index}`}>{item.value}</span>;
      })}
    </>
  );
}

const ToolActivityRow = memo(function ToolActivityRow({
  verb,
  main,
  meta,
  status = 'ok',
  expandable = false,
  expanded = false,
  onToggle,
  detail,
  className,
  title,
}: ToolActivityRowProps) {
  const isStatic = !expandable;
  const rowClass = [
    styles.row,
    statusClass(status),
    expanded ? styles.isOpen : '',
    isStatic ? styles.isStatic : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  const gutter = expandable ? (
    <svg
      className={styles.chevron}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  ) : (
    <span className={styles.dot} aria-hidden="true" />
  );

  const body = (
    <>
      <span className={styles.gutter}>{gutter}</span>
      <span className={styles.verb}>{verb}</span>
      <span className={styles.main}>{main}</span>
      {meta && meta.length > 0 && (
        <span className={styles.meta}>
          <MetaItems items={meta} />
        </span>
      )}
    </>
  );

  return (
    <div className={styles.wrap} data-testid="tool-activity-row">
      {expandable ? (
        <button
          type="button"
          className={rowClass}
          onClick={onToggle}
          aria-expanded={expanded}
          title={title}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass} title={title}>
          {body}
        </div>
      )}
      {expandable && detail != null && (
        <div
          className={`${styles.detail} ${expanded ? styles.detailExpanded : ''}`}
          aria-hidden={!expanded}
        >
          <div
            className={`${styles.detailInner} ${expanded ? styles.detailInnerExpanded : ''}`}
          >
            {detail}
          </div>
        </div>
      )}
    </div>
  );
});

export function ToolActivityPath({
  path,
  suffix,
  strike,
}: {
  path: string;
  suffix?: string;
  strike?: boolean;
}) {
  return (
    <>
      <span className={strike ? styles.strike : undefined}>{path}</span>
      {suffix ? <span className={styles.muted}> {suffix}</span> : null}
    </>
  );
}

export function ToolActivityCommand({ command }: { command: string }) {
  return (
    <>
      <span className={styles.prompt}>$</span>
      <span>{command}</span>
    </>
  );
}

export function ToolActivityChildren({
  items,
}: {
  items: Array<{ id: string; name: string; meta?: string }>;
}) {
  return (
    <div className={styles.children}>
      {items.map((item) => (
        <div key={item.id} className={styles.child}>
          <span className={styles.childMark}>·</span>
          <span className={styles.childName}>{item.name}</span>
          {item.meta ? <span className={styles.childMeta}>{item.meta}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function ToolActivityDetailPre({ children }: { children: string }) {
  return <pre className={styles.detailPre}>{children}</pre>;
}

/** Shorten absolute/long paths to ~/tail */
export function shortActivityPath(path: string, tail = 2): string {
  if (!path) return '';
  const segs = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segs.length === 0) return path;
  if (segs.length <= tail) return `~/${segs.join('/')}`;
  return `~/${segs.slice(-tail).join('/')}`;
}

export default ToolActivityRow;
