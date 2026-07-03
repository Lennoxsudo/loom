import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { showSuccess } from '../../utils/notification';
import { CopyIcon } from '../shared/Icons';
import type { ParsedCommandExec } from '../../utils/parseCommandExecOutput';
import styles from './ExecCommandCard.module.css';

const COLLAPSE_LINE_LIMIT = 20;

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export type ExecCommandCardProps = {
  dense?: boolean;
  parsed: ParsedCommandExec;
  isRunning: boolean;
  isError: boolean;
  footer?: ReactNode;
  approvalStatus?: 'pending' | 'approved' | 'denied';
};

const ExecCommandCard = memo(function ExecCommandCard({
  dense,
  parsed,
  isRunning,
  isError,
  footer,
  approvalStatus,
}: ExecCommandCardProps) {
  const t = useTranslation();
  const outputRef = useRef<HTMLPreElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [outputFullyExpanded, setOutputFullyExpanded] = useState(false);
  const wasRunningRef = useRef(isRunning);

  // ── 运行时计时器 ──
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      const timer = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setElapsedMs(0);
    }
  }, [isRunning]);

  const elapsedDisplay = isRunning && elapsedMs > 0 ? `(${formatDuration(elapsedMs)})` : '';
  const showRunningWarning = isRunning && elapsedMs > 25_000 && !parsed.output;

  const lineCount = useMemo(() => {
    if (!parsed.output) return 0;
    return parsed.output.split('\n').length;
  }, [parsed.output]);

  const shouldTruncate = outputExpanded && lineCount > COLLAPSE_LINE_LIMIT && !outputFullyExpanded;
  const showBody = outputExpanded || isRunning;

  // 执行完成时补偿输出折叠后的高度损失，使底部吸附保持生效
  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      requestAnimationFrame(() => {
        // 从卡片根元素向上查找最近的可滚动父容器，推到底部
        let el: HTMLElement | null = cardRef.current;
        for (let i = 0; i < 20 && el; i++) {
          if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto') {
            el.scrollTop = el.scrollHeight;
            break;
          }
          el = el.parentElement;
        }
      });
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (!outputExpanded) {
      setOutputFullyExpanded(false);
    }
  }, [outputExpanded]);

  useEffect(() => {
    if (!isRunning || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [parsed.output, isRunning]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(parsed.command);
      showSuccess(t.agent.execCommand.copied);
    } catch {
      // ignore clipboard failures
    }
  }, [parsed.command, t.agent.execCommand.copied]);

  const exitDisplay =
    parsed.exitCode === null ? '—' : String(parsed.exitCode);
  const exitClass =
    parsed.exitCode === null
      ? styles.metaMuted
      : parsed.exitCode === 0
        ? styles.exitSuccess
        : styles.exitFailure;

  return (
    <div
      ref={cardRef}
      className={`${styles.execCard} ${dense ? styles.execCardDense : ''} ${
        approvalStatus === 'pending'
          ? styles.execCardPending
          : approvalStatus === 'approved'
            ? styles.execCardApproved
            : approvalStatus === 'denied'
              ? styles.execCardDenied
              : ''
      }`}
      data-testid="exec-command-card"
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.headerToggle}
          onClick={() => setOutputExpanded((value) => !value)}
          aria-expanded={showBody}
          aria-label={outputExpanded ? t.agent.execCommand.collapse : t.agent.execCommand.expandAll}
        >
          <span
            className={`${styles.chevron} ${showBody ? styles.chevronOpen : ''}`}
            aria-hidden="true"
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
          <span className={styles.prompt} aria-hidden="true">
            $
          </span>
          <div className={styles.commandLine}>{parsed.command}</div>
        </button>
        {isRunning && (
          <span className={styles.running} aria-live="polite">
            <span className={styles.runningDot} aria-hidden="true" />
            {elapsedDisplay ? (
              <span className={styles.metaMuted}>{elapsedDisplay}</span>
            ) : (
              <span className={styles.metaMuted}>{t.agent.execCommand.running}</span>
            )}
          </span>
        )}
        <button
          type="button"
          className={styles.copyButton}
          onClick={(event) => {
            event.stopPropagation();
            void handleCopy();
          }}
          aria-label={t.agent.execCommand.copyCommand}
          title={t.agent.copy}
        >
          <CopyIcon size={12} />
        </button>
      </div>

      {showBody && (
      <div className={styles.body}>
        {parsed.isBackgroundStart ? (
          <div className={styles.backgroundNote}>{parsed.output}</div>
        ) : isRunning && !parsed.output ? (
          <div className={styles.emptyOutput}>{t.agent.execCommand.running}</div>
        ) : parsed.output ? (
          <>
            <pre
              ref={outputRef}
              className={`${styles.output} ${shouldTruncate ? styles.outputCollapsed : ''}`}
            >
              {parsed.output}
            </pre>
            {shouldTruncate && <div className={styles.outputFade} aria-hidden="true" />}
          </>
        ) : (
          <div className={styles.emptyOutput}>{t.agent.execCommand.noOutput}</div>
        )}
        {showRunningWarning && (
          <div className={styles.timeoutWarning}>
            <span>⚡</span>
            <span>{t.agent.execCommand.runningLong}</span>
          </div>
        )}

        {shouldTruncate && (
          <div className={styles.expandRow}>
            <button
              type="button"
              className={styles.expandButton}
              onClick={() => setOutputFullyExpanded(true)}
            >
              {t.agent.execCommand.expandAll}
            </button>
          </div>
        )}

        {outputFullyExpanded && lineCount > COLLAPSE_LINE_LIMIT && (
          <div className={styles.expandRow}>
            <button
              type="button"
              className={styles.expandButton}
              onClick={() => setOutputFullyExpanded(false)}
            >
              {t.agent.execCommand.collapse}
            </button>
          </div>
        )}
      </div>
      )}

      {!footer && showBody && !isRunning && (
        <div className={styles.footer}>
          <span className={exitClass}>
            {t.agent.execCommand.exitCode}
            <span className={styles.metaValue}>{exitDisplay}</span>
          </span>
          <span className={styles.metaMuted}>
            {t.agent.execCommand.duration}
            <span className={styles.metaValue}>{formatDuration(parsed.durationMs)}</span>
          </span>
          {isError && <span className={styles.exitFailure}>{t.common.failed}</span>}
        </div>
      )}
      {footer}
    </div>
  );
});

export default ExecCommandCard;
