import { memo, useMemo } from 'react';
import { useSubagentStore } from '../../stores/useSubagentStore';
import { useTranslation } from '../../i18n';
import type { PersistedSubagentRun } from '../../types/subagent';
import SubagentCard from './SubagentCard';
import groupStyles from './SubagentGroupCard.module.css';

interface SubagentGroupCardProps {
  toolCallId: string;
  persistedRuns?: PersistedSubagentRun[];
}

function MiniSpinner() {
  return (
    <svg
      style={{ animation: 'saSpin 0.9s linear infinite', width: 8, height: 8 }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="rgba(255, 255, 255, 0.1)" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

const SubagentGroupCard = memo(function SubagentGroupCard({
  toolCallId,
  persistedRuns,
}: SubagentGroupCardProps) {
  const runs = useSubagentStore((state) => state.runs);
  const t = useTranslation();

  const subTaskIds = useMemo(() => {
    const liveIds = Object.keys(runs)
      .filter((id) => id.startsWith(`${toolCallId}-`))
      .sort((a, b) => {
        const partsA = a.split('-');
        const partsB = b.split('-');
        const idxA = parseInt(partsA[partsA.length - 2] || '0', 10);
        const idxB = parseInt(partsB[partsB.length - 2] || '0', 10);
        return idxA - idxB;
      });
    if (liveIds.length > 0) {
      return liveIds;
    }
    return (persistedRuns ?? []).map((record) => record.task.id);
  }, [runs, toolCallId, persistedRuns]);

  const persistedByTaskId = useMemo(() => {
    const map = new Map<string, PersistedSubagentRun>();
    for (const record of persistedRuns ?? []) {
      map.set(record.task.id, record);
    }
    return map;
  }, [persistedRuns]);

  const stats = useMemo(() => {
    let running = 0;
    let succeeded = 0;
    let failed = 0;
    let pending = 0;
    let cancelled = 0;

    subTaskIds.forEach((id) => {
      const run = runs[id];
      if (!run) return;
      if (run.status === 'running') running++;
      else if (run.status === 'succeeded') succeeded++;
      else if (run.status === 'failed') failed++;
      else if (run.status === 'pending') pending++;
      else if (run.status === 'cancelled') cancelled++;
    });

    return { running, succeeded, failed, pending, cancelled };
  }, [runs, subTaskIds]);

  const handleCancelAll = () => {
    subTaskIds.forEach((id) => {
      const run = runs[id];
      if (run && (run.status === 'running' || run.status === 'pending')) {
        useSubagentStore.getState().cancelSubagent(id);
      }
    });
  };

  if (subTaskIds.length === 0) {
    return <div className={groupStyles.delegating}>{t.subagent.delegating}</div>;
  }

  return (
    <div className={groupStyles.root}>
      <div className={groupStyles.banner}>
        <div className={groupStyles.bannerTitle}>
          {t.subagent.parallelSubagents.replace('{count}', String(subTaskIds.length))}
        </div>
        <div className={groupStyles.stats}>
          {(stats.running > 0 || stats.pending > 0) && (
            <button type="button" className={groupStyles.cancelAllBtn} onClick={handleCancelAll}>
              {t.subagent.cancelAll}
            </button>
          )}
          {stats.pending > 0 && (
            <span className={groupStyles.statPending}>
              {t.subagent.pendingCount.replace('{count}', String(stats.pending))}
            </span>
          )}
          {stats.running > 0 && (
            <span className={groupStyles.statRunning}>
              <MiniSpinner />
              {t.subagent.runningCount.replace('{count}', String(stats.running))}
            </span>
          )}
          {stats.succeeded > 0 && (
            <span className={groupStyles.statSucceeded}>
              {t.subagent.succeededCount.replace('{count}', String(stats.succeeded))}
            </span>
          )}
          {stats.cancelled > 0 && (
            <span className={groupStyles.statCancelled}>
              {t.subagent.cancelledCount.replace('{count}', String(stats.cancelled))}
            </span>
          )}
          {stats.failed > 0 && (
            <span className={groupStyles.statFailed}>
              {t.subagent.failedCount.replace('{count}', String(stats.failed))}
            </span>
          )}
        </div>
      </div>

      <div className={groupStyles.list}>
        {subTaskIds.map((id) => {
          const persisted = persistedByTaskId.get(id);
          return (
            <SubagentCard
              key={id}
              taskId={id}
              fallbackDescription={persisted?.task.description}
              fallbackSubagentType={persisted?.task.subagentType}
              fallbackStatus={persisted?.status}
            />
          );
        })}
      </div>
    </div>
  );
});

export default SubagentGroupCard;
