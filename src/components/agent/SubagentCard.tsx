import { memo, useState, useMemo, useEffect, type CSSProperties } from 'react';
import { useSubagentStore } from '../../stores/useSubagentStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from '../shared/MarkdownRenderers';
import { useTranslation } from '../../i18n';
import ToolApprovalBar from './ToolApprovalBar';
import styles from './SubagentCard.module.css';
import type { SubagentRunStatus } from '../../types/subagent';
import type { SubagentTimelineEntry } from '../../types/subagent';
import { resolveSubagentTimeline } from './subagentTimeline';
import { formatToolDisplayName } from './toolResultLayout';

interface SubagentCardProps {
  taskId: string;
  fallbackDescription?: string;
  fallbackSubagentType?: string;
  /** When store has no live run, render this terminal/active status instead of default pending. */
  fallbackStatus?: SubagentRunStatus;
}

function useLiveElapsedMs(startedAt?: number, active = false): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !startedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  if (!startedAt) return 0;
  return Math.max(0, now - startedAt);
}

const THINKING_COLLAPSE_THRESHOLD = 180;

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function formatStatusLabel(status: SubagentRunStatus, t: ReturnType<typeof useTranslation>): string {
  switch (status) {
    case 'pending':
      return t.subagent.statusPending;
    case 'running':
      return t.subagent.statusRunning;
    case 'succeeded':
      return t.subagent.statusSucceeded;
    case 'failed':
      return t.subagent.statusFailed;
    case 'cancelled':
      return t.subagent.statusCancelled;
    default:
      return status;
  }
}

function formatTypeLabel(type?: string): string {
  if (!type?.trim()) return 'general-purpose';
  return type.trim();
}

function cardStatusClass(status: SubagentRunStatus, pendingApproval: boolean): string {
  if (pendingApproval) return styles.cardPendingApproval;
  switch (status) {
    case 'running':
      return styles.cardRunning;
    case 'succeeded':
      return styles.cardSucceeded;
    case 'failed':
      return styles.cardFailed;
    case 'cancelled':
      return styles.cardCancelled;
    case 'pending':
      return styles.cardPending;
    default:
      return '';
  }
}

function MiniSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="rgba(255, 255, 255, 0.12)" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

function ThinkingTimelineStep({
  entry,
  isLive,
  expanded,
  onToggle,
  thinkLabel,
  expandHint,
}: {
  entry: Extract<SubagentTimelineEntry, { kind: 'thinking' }>;
  isLive: boolean;
  expanded: boolean;
  onToggle: () => void;
  thinkLabel: string;
  expandHint: string;
}) {
  const isLong = entry.text.length > THINKING_COLLAPSE_THRESHOLD;
  const showToggle = isLong;

  return (
    <div className={styles.timelineStep}>
      <span
        className={`${styles.timelineDot} ${styles.timelineDotThinking}${
          isLive ? ` ${styles.timelineDotThinkingLive}` : ''
        }`}
      />
      {showToggle ? (
        <button type="button" className={styles.thinkingToggle} onClick={onToggle}>
          <span className={styles.stepKind}>{thinkLabel}</span>
          {isLive && (
            <span className={`${styles.stepStatus} ${styles.stepStatusRunning}`}>
              <MiniSpinner className={styles.spinner} />
            </span>
          )}
        </button>
      ) : (
        <div className={styles.stepHeader}>
          <span className={styles.stepKind}>{thinkLabel}</span>
          {isLive && (
            <span className={`${styles.stepStatus} ${styles.stepStatusRunning}`}>
              <MiniSpinner className={styles.spinner} />
            </span>
          )}
        </div>
      )}
      <p
        className={`${styles.thinkingBody} ${showToggle && !expanded ? styles.thinkingBodyCollapsed : ''}`}
      >
        {entry.text.trim()}
      </p>
      {showToggle && !expanded && (
        <button type="button" className={styles.thinkingExpandHint} onClick={onToggle}>
          {expandHint}
        </button>
      )}
    </div>
  );
}

function ToolTimelineStep({
  entry,
  statusLabels,
}: {
  entry: Extract<SubagentTimelineEntry, { kind: 'tool' }>;
  statusLabels: { running: string; done: string; error: string };
}) {
  const dotClass =
    entry.status === 'running'
      ? `${styles.timelineDotTool} ${styles.timelineDotToolRunning}`
      : entry.status === 'error'
        ? `${styles.timelineDotToolError}`
        : styles.timelineDotTool;

  const statusClass =
    entry.status === 'running'
      ? styles.stepStatusRunning
      : entry.status === 'error'
        ? styles.stepStatusError
        : styles.stepStatusDone;

  const statusText =
    entry.status === 'running'
      ? statusLabels.running
      : entry.status === 'error'
        ? statusLabels.error
        : statusLabels.done;

  return (
    <div className={styles.timelineStep}>
      <span className={`${styles.timelineDot} ${dotClass}`} />
      <div className={styles.stepHeader}>
        <code className={styles.stepToolName}>{formatToolDisplayName(entry.toolName)}</code>
        <span className={`${styles.stepStatus} ${statusClass}`}>
          {entry.status === 'running' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MiniSpinner className={styles.spinner} />
              {statusText}
            </span>
          ) : (
            statusText
          )}
        </span>
      </div>
      {entry.resultPreview && (
        <pre className={styles.toolPreview}>{entry.resultPreview}</pre>
      )}
    </div>
  );
}

const SubagentCard = memo(function SubagentCard({
  taskId,
  fallbackDescription,
  fallbackSubagentType,
  fallbackStatus,
}: SubagentCardProps) {
  const t = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});

  const run = useSubagentStore((state) => state.runs[taskId]);
  const liveElapsedMs = useLiveElapsedMs(
    run?.startedAt,
    run?.status === 'running' || run?.status === 'pending'
  );

  const metrics = useMemo(() => {
    if (!run) return null;
    if (run.result?.metrics) return run.result.metrics;
    if (run.startedAt && run.finishedAt) {
      return {
        durationMs: run.finishedAt - run.startedAt,
        steps: run.steps || 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
    }
    return null;
  }, [run]);

  const timeline = useMemo(() => (run ? resolveSubagentTimeline(run) : []), [run]);

  const statusLabel = useMemo(() => {
    if (!run) return '';
    if (run.pendingApproval) return t.subagent.statusPendingApproval;
    return formatStatusLabel(run.status, t);
  }, [run, t]);

  const toggleThinking = (id: string) => {
    setExpandedThinking((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!run) {
    if (fallbackDescription || fallbackStatus) {
      const effectiveStatus = fallbackStatus ?? 'pending';
      const typeLabel = formatTypeLabel(fallbackSubagentType);
      const showPulse = effectiveStatus === 'running' || effectiveStatus === 'pending';
      return (
        <div className={styles.root}>
          <div className={`${styles.card} ${cardStatusClass(effectiveStatus, false)}`}>
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.identity}>
                  <span className={styles.eyebrow}>{t.subagent.label}</span>
                  <span className={styles.sep} aria-hidden>
                    ·
                  </span>
                  <span className={styles.typeName} title={typeLabel}>
                    {typeLabel}
                  </span>
                </div>
                <div className={styles.headerActions}>
                  <span className={styles.status}>
                    <span
                      className={`${styles.statusDot} ${showPulse ? styles.statusDotPulse : ''}`}
                    />
                    {formatStatusLabel(effectiveStatus, t)}
                  </span>
                </div>
              </div>
              {fallbackDescription ? (
                <p className={styles.description} title={fallbackDescription}>
                  {fallbackDescription}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <div className={styles.loading}>
          <MiniSpinner className={styles.spinner} />
          <span>{t.subagent.initializing}</span>
        </div>
      </div>
    );
  }

  const {
    task,
    status,
    steps = 0,
    streamingText = '',
    result,
  } = run;

  const isTerminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';
  const textContent = result?.summary || streamingText;
  const typeLabel = formatTypeLabel(task.subagentType);
  const showStatusPulse = (status === 'running' || status === 'pending') && !run.pendingApproval;
  const lastTimelineEntry = timeline[timeline.length - 1];
  const isThinkingLive =
    status === 'running' && lastTimelineEntry?.kind === 'thinking';

  return (
    <div className={styles.root}>
      <div
        className={`${styles.card} ${cardStatusClass(status, !!run.pendingApproval)}`}
        style={
          task.color ? ({ '--sa-accent': task.color } as CSSProperties) : undefined
        }
      >
        <div
          className={styles.header}
          role="button"
          tabIndex={0}
          onClick={() => setIsExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded((prev) => !prev);
            }
          }}
        >
          <div className={styles.headerTop}>
            <div className={styles.identity}>
              <span className={styles.eyebrow}>{t.subagent.label}</span>
              <span className={styles.sep} aria-hidden>
                ·
              </span>
              <span className={styles.typeName} title={typeLabel}>
                {typeLabel}
              </span>
              {task.spawnMode === 'fork' && (
                <span className={styles.forkBadge}>fork</span>
              )}
            </div>

            <div className={styles.headerActions}>
              {(status === 'running' || status === 'pending') && (
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    useSubagentStore.getState().cancelSubagent(taskId);
                  }}
                >
                  {t.subagent.cancelButton}
                </button>
              )}

              <span className={styles.status}>
                <span
                  className={`${styles.statusDot} ${showStatusPulse ? styles.statusDotPulse : ''}`}
                />
                {statusLabel}
              </span>

              <span
                className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
                aria-hidden
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </div>

          <p className={styles.description} title={task.description}>
            {task.description}
          </p>

          {(steps > 0 ||
            (!isTerminal && liveElapsedMs > 0) ||
            (isTerminal && metrics && (metrics.durationMs > 0 || metrics.totalTokens > 0))) && (
            <div className={styles.metaStrip}>
              {steps > 0 && (
                <span className={styles.metaItem}>
                  {t.subagent.stepsCount.replace('{count}', String(steps))}
                </span>
              )}
              {!isTerminal && liveElapsedMs > 0 && (
                <span className={styles.metaItem}>
                  {t.subagent.durationSeconds.replace('{seconds}', formatDuration(liveElapsedMs))}
                </span>
              )}
              {isTerminal && metrics && metrics.durationMs > 0 && (
                <span className={styles.metaItem}>
                  {t.subagent.durationSeconds.replace('{seconds}', formatDuration(metrics.durationMs))}
                </span>
              )}
              {isTerminal && metrics && metrics.totalTokens > 0 && (
                <span className={styles.metaItem}>
                  {t.subagent.tokensApprox.replace('{count}', String(metrics.totalTokens))}
                </span>
              )}
            </div>
          )}
        </div>

        {run.pendingApproval && (
          <div className={styles.approval}>
            <div className={styles.approvalDetail}>
              <div className={styles.approvalToolRow}>
                <span className={styles.approvalToolLabel}>{t.subagent.toolLabel}</span>
                <code className={styles.approvalToolName}>{formatToolDisplayName(run.pendingApproval.toolName)}</code>
              </div>
              <pre className={styles.approvalCode}>{run.pendingApproval.detailPreview}</pre>
            </div>
            <ToolApprovalBar
              status="pending"
              layout="footer"
              onApprove={() => run.pendingApproval?.resolve('approve')}
              onReject={() => run.pendingApproval?.resolve('reject')}
            />
          </div>
        )}

        {isExpanded && (
          <div className={styles.body}>
            {timeline.length > 0 && (
              <div className={styles.timeline}>
                {timeline.map((entry, index) => {
                  if (entry.kind === 'thinking') {
                    const isLast = index === timeline.length - 1;
                    return (
                      <ThinkingTimelineStep
                        key={entry.id}
                        entry={entry}
                        isLive={isThinkingLive && isLast}
                        expanded={!!expandedThinking[entry.id]}
                        onToggle={() => toggleThinking(entry.id)}
                        thinkLabel={t.subagent.timelineThink}
                        expandHint={t.subagent.expandThinking}
                      />
                    );
                  }
                  return (
                    <ToolTimelineStep
                      key={entry.id}
                      entry={entry}
                      statusLabels={{
                        running: t.subagent.toolRunning,
                        done: t.subagent.toolDone,
                        error: t.subagent.toolError,
                      }}
                    />
                  );
                })}
              </div>
            )}

            <div className={styles.summarySection}>
              <div className={styles.summaryLabel}>
                {status === 'running' ? t.subagent.realtimeOutput : t.subagent.finalSummary}
              </div>
              <div className={styles.summaryBox}>
                {textContent ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {textContent}
                  </ReactMarkdown>
                ) : (
                  <span className={styles.summaryPlaceholder}>
                    {status === 'running'
                      ? t.subagent.waitingResponse
                      : t.subagent.noSummary}
                  </span>
                )}
              </div>
            </div>

            {isTerminal && metrics && metrics.totalTokens > 0 && (
              <div className={styles.metricsFooter}>
                {t.subagent.metricsSummary
                  .replace('{duration}', formatDuration(metrics.durationMs))
                  .replace('{steps}', String(metrics.steps))
                  .replace('{tokens}', String(metrics.totalTokens))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default SubagentCard;
