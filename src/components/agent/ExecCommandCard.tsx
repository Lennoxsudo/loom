import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { showSuccess } from '../../utils/notification';
import { CopyIcon } from '../shared/Icons';
import type { ParsedCommandExec } from '../../utils/parseCommandExecOutput';
import styles from './ExecCommandCard.module.css';

const COLLAPSE_LINE_LIMIT = 10;

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
    }
    setElapsedMs(0);
  }, [isRunning]);

  const lineCount = useMemo(() => {
    if (!parsed.output) return 0;
    return parsed.output.split('\n').length;
  }, [parsed.output]);

  const shouldTruncate = outputExpanded && lineCount > COLLAPSE_LINE_LIMIT && !outputFullyExpanded;
  const showBody = outputExpanded || isRunning;

  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      requestAnimationFrame(() => {
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

  const handleCopyOutput = useCallback(async () => {
    if (!parsed.output) return;
    try {
      await navigator.clipboard.writeText(parsed.output);
      showSuccess(t.agent.execCommand.copiedOutput);
    } catch {
      // ignore clipboard failures
    }
  }, [parsed.output, t.agent.execCommand.copiedOutput]);

  const exitDisplay =
    parsed.exitCode === null ? (isRunning ? 'run' : '—') : String(parsed.exitCode);
  const durationDisplay = isRunning
    ? elapsedMs > 0
      ? formatDuration(elapsedMs)
      : t.agent.execCommand.running
    : formatDuration(parsed.durationMs);

  const statusClass = isRunning
    ? styles.isRun
    : isError || (parsed.exitCode !== null && parsed.exitCode !== 0)
      ? styles.isError
      : styles.isOk;

  const approvalClass =
    approvalStatus === 'pending'
      ? styles.execCardPending
      : approvalStatus === 'approved'
        ? styles.execCardApproved
        : approvalStatus === 'denied'
          ? styles.execCardDenied
          : '';

  return (
    <div
      ref={cardRef}
      className={`${styles.execCard} ${dense ? styles.execCardDense : ''} ${statusClass} ${
        showBody ? styles.isOpen : ''
      } ${approvalClass}`}
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
          <span className={styles.verb}>exec</span>
          <span className={styles.commandMain}>
            <span className={styles.prompt} aria-hidden="true">
              $
            </span>
            <span className={styles.commandLine}>{parsed.command}</span>
          </span>
        </button>

        <div className={styles.meta}>
          <span
            className={
              isRunning
                ? styles.metaMuted
                : parsed.exitCode === null
                  ? styles.metaMuted
                  : parsed.exitCode === 0
                    ? styles.exitSuccess
                    : styles.exitFailure
            }
          >
            {exitDisplay}
          </span>
          <span className={styles.metaSep} aria-hidden="true" />
          <span className={styles.metaMuted}>{durationDisplay}</span>
          {!isRunning && lineCount > 0 && (
            <>
              <span className={styles.metaSep} aria-hidden="true" />
              <span className={styles.metaMuted}>
                {lineCount} {t.agent.execCommand.lines}
              </span>
            </>
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
            <CopyIcon size={11} />
          </button>
        </div>
      </div>

      <div
        className={`${styles.body} ${showBody ? styles.bodyExpanded : ''}`}
        data-testid="exec-command-body"
        aria-hidden={!showBody}
      >
        <div className={`${styles.bodyInner} ${showBody ? styles.bodyInnerExpanded : ''}`}>
          {parsed.isBackgroundStart ? (
            <div className={styles.backgroundNote}>{parsed.output}</div>
          ) : isRunning && !parsed.output ? (
            <div className={styles.emptyOutput}>{t.agent.execCommand.running}</div>
          ) : parsed.output ? (
            <pre
              ref={outputRef}
              className={`${styles.output} ${shouldTruncate ? styles.outputCollapsed : ''}`}
            >
              {parsed.output}
            </pre>
          ) : (
            <div className={styles.emptyOutput}>{t.agent.execCommand.noOutput}</div>
          )}

          {isRunning && elapsedMs > 25_000 && !parsed.output && (
            <div className={styles.timeoutWarning}>
              <span>⚡</span>
              <span>{t.agent.execCommand.runningLong}</span>
            </div>
          )}

          {!isRunning && (
            <div className={styles.rail}>
              <div className={styles.railLeft}>
                <span>
                  {t.agent.execCommand.exitCode}
                  <span className={styles.metaValue}>{parsed.exitCode === null ? '—' : String(parsed.exitCode)}</span>
                </span>
                <span>
                  {t.agent.execCommand.duration}
                  <span className={styles.metaValue}>{formatDuration(parsed.durationMs)}</span>
                </span>
                {lineCount > 0 && (
                  <span>
                    {lineCount} {t.agent.execCommand.lines}
                  </span>
                )}
                {isError && <span className={styles.exitFailure}>{t.common.failed}</span>}
              </div>
              <div className={styles.railRight}>
                {shouldTruncate && (
                  <button
                    type="button"
                    className={styles.railLink}
                    onClick={() => setOutputFullyExpanded(true)}
                  >
                    {t.agent.execCommand.expandAll}
                  </button>
                )}
                {outputFullyExpanded && lineCount > COLLAPSE_LINE_LIMIT && (
                  <button
                    type="button"
                    className={styles.railLink}
                    onClick={() => setOutputFullyExpanded(false)}
                  >
                    {t.agent.execCommand.collapse}
                  </button>
                )}
                {parsed.output && (
                  <button
                    type="button"
                    className={styles.railLink}
                    onClick={() => void handleCopyOutput()}
                  >
                    {t.agent.execCommand.copyOutput}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {footer}
    </div>
  );
});

export default ExecCommandCard;
