import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import type { BackgroundTaskSummary } from '../../types/ai';
import styles from './BgTaskBadge.module.css';

const POLL_INTERVAL = 5000;

export interface BgTaskBadgeProps {
  conversationId?: string | null;
}

export function filterBackgroundTasksForConversation(
  tasks: BackgroundTaskSummary[],
  conversationId?: string | null
): BackgroundTaskSummary[] {
  const running = tasks.filter((task) => !task.completed);
  const currentId = conversationId?.trim();
  if (!currentId) {
    return running.filter((task) => !task.conversation_id?.trim());
  }
  return running.filter((task) => task.conversation_id?.trim() === currentId);
}

const BgTaskBadge = memo(function BgTaskBadge({ conversationId = null }: BgTaskBadgeProps) {
  const t = useTranslation();
  const [tasks, setTasks] = useState<BackgroundTaskSummary[]>([]);
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await invoke<BackgroundTaskSummary[]>('list_background_commands');
        if (!cancelled) {
          setTasks(result.filter((task) => !task.completed));
        }
      } catch {
        // ignore
      }
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  const runningTasks = useMemo(
    () => filterBackgroundTasksForConversation(tasks, conversationId),
    [tasks, conversationId]
  );

  const handleKill = useCallback(async (taskId: string) => {
    try {
      await invoke('kill_background_command', { taskId });
      setTasks((prev) => prev.filter((task) => task.task_id !== taskId));
    } catch {
      // ignore
    }
  }, []);

  const handleKillAll = useCallback(async () => {
    for (const task of runningTasks) {
      await invoke('kill_background_command', { taskId: task.task_id });
    }
    const killedIds = new Set(runningTasks.map((task) => task.task_id));
    setTasks((prev) => prev.filter((task) => !killedIds.has(task.task_id)));
    setExpanded(false);
  }, [runningTasks]);

  if (runningTasks.length === 0) return null;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.badge}
        onClick={() => setExpanded((value) => !value)}
        title={`${runningTasks.length} ${t.agent.bgTask.running}`}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span>{runningTasks.length}</span>
      </button>

      {expanded && (
        <div className={styles.popover}>
          <div className={styles.popoverHeader}>
            <span className={styles.popoverTitle}>
              {t.agent.bgTask.title} ({runningTasks.length})
            </span>
            {runningTasks.length > 1 && (
              <button type="button" className={styles.killAllBtn} onClick={handleKillAll}>
                {t.agent.bgTask.killAll}
              </button>
            )}
          </div>
          <div className={styles.taskList}>
            {runningTasks.map((task) => (
              <div key={task.task_id} className={styles.taskRow}>
                <span className={styles.taskCmd}>{task.command}</span>
                <button
                  type="button"
                  className={styles.killBtn}
                  onClick={() => handleKill(task.task_id)}
                  title={t.agent.bgTask.kill}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default BgTaskBadge;
