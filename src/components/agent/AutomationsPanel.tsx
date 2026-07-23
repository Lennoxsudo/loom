import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  useAutomationStore,
  useAutomationTasks,
  DEFAULT_AUTOMATION_ACCESS_MODE,
} from '../../stores/useAutomationStore';
import type {
  AutomationTask,
  AutomationTrigger,
  AutomationTriggerType,
  CreateAutomationTaskPayload,
  UpdateAutomationTaskPayload,
  AutomationRunRecord,
} from '../../types/automation';
import type { AgentAccessMode } from '../../types/settings';
import { computeNextRunAt } from '../../stores/useAutomationStore';
import styles from './AutomationsPanel.module.css';

// ── Props ──────────────────────────────────────────────────────────────────

interface AutomationsPanelProps {
  projectPath: string;
  onClose: () => void;
}

// ── Main Panel ─────────────────────────────────────────────────────────────

function AutomationsPanel({ projectPath, onClose }: AutomationsPanelProps) {
  const t = useTranslation();
  const tasks = useAutomationTasks();
  const loadTasks = useAutomationStore((s) => s.loadTasks);
  const createTask = useAutomationStore((s) => s.createTask);
  const deleteTask = useAutomationStore((s) => s.deleteTask);
  const setEnabled = useAutomationStore((s) => s.setEnabled);
  const runNow = useAutomationStore((s) => s.runNow);

  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationTask | null>(null);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleCreate = useCallback(() => {
    setEditingTask(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((task: AutomationTask) => {
    setEditingTask(task);
    setShowForm(true);
  }, []);

  const handleToggleEnabled = useCallback(
    (id: string, enabled: boolean) => {
      void setEnabled(id, enabled);
    },
    [setEnabled]
  );

  const handleRunNow = useCallback(
    (id: string) => {
      void runNow(id);
    },
    [runNow]
  );

  const handleRequestDelete = useCallback((task: AutomationTask) => {
    setDeleteTarget(task);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      void deleteTask(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteTask]);

  const handleToggleHistory = useCallback((id: string) => {
    setExpandedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingTask(null);
  }, []);

  const handleFormSubmit = useCallback(
    async (
      payload: CreateAutomationTaskPayload | UpdateAutomationTaskPayload,
      isEdit: boolean,
      id?: string
    ) => {
      if (isEdit && id) {
        const { updateTask } = useAutomationStore.getState();
        await updateTask(id, payload as UpdateAutomationTaskPayload);
      } else {
        await createTask(payload as CreateAutomationTaskPayload);
      }
      setShowForm(false);
      setEditingTask(null);
    },
    [createTask]
  );

  return (
    <div className={styles.panel} data-testid="automations-panel">
      <div className={styles.header}>
        <span className={styles.title}>{t.agent.automations.title}</span>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={styles.body}>
        {tasks.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>◷</span>
            <span>{t.agent.automations.emptyHint}</span>
          </div>
        ) : (
          <div className={styles.taskList}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                t={t}
                expanded={expandedHistoryIds.has(task.id)}
                onToggleEnabled={handleToggleEnabled}
                onEdit={handleEdit}
                onRunNow={handleRunNow}
                onRequestDelete={handleRequestDelete}
                onToggleHistory={handleToggleHistory}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.addButton} onClick={handleCreate}>
          + {t.agent.automations.createTask}
        </button>
      </div>

      {showForm && (
        <TaskFormDialog
          t={t}
          projectPath={projectPath}
          existingTask={editingTask}
          onSubmit={handleFormSubmit}
          onClose={handleFormClose}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          t={t}
          taskName={deleteTarget.name}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Task Card ──────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: AutomationTask;
  t: ReturnType<typeof useTranslation>;
  expanded: boolean;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onEdit: (task: AutomationTask) => void;
  onRunNow: (id: string) => void;
  onRequestDelete: (task: AutomationTask) => void;
  onToggleHistory: (id: string) => void;
}

const TaskCard = memo(function TaskCard({
  task,
  t,
  expanded,
  onToggleEnabled,
  onEdit,
  onRunNow,
  onRequestDelete,
  onToggleHistory,
}: TaskCardProps) {
  const triggerLabel = useMemo(() => {
    switch (task.trigger.type) {
      case 'interval':
        return `${t.agent.automations.triggerInterval} ${task.trigger.minutes}${t.agent.automations.minutesUnit}`;
      case 'cron':
        return `${t.agent.automations.triggerCron} ${task.trigger.expression}`;
      case 'file_change':
        return t.agent.automations.triggerFileChange;
    }
  }, [task.trigger, t]);

  const nextRunLabel = useMemo(() => {
    if (!task.enabled) return t.agent.automations.disabled;
    const next = computeNextRunAt(task.trigger, task.lastRunAt, task.nextRunAt);
    if (!next) return '—';
    return new Date(next).toLocaleString();
  }, [task.enabled, task.trigger, task.lastRunAt, task.nextRunAt, t.agent.automations.disabled]);

  return (
    <div className={styles.taskCard}>
      <div className={styles.taskHeader}>
        <span className={styles.taskName}>{task.name}</span>
        <div className={styles.taskActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => onEdit(task)}
            title={t.agent.automations.edit}
          >
            ✎
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => onRunNow(task.id)}
            title={t.agent.automations.runNow}
          >
            ▶
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.danger}`}
            onClick={() => onRequestDelete(task)}
            title={t.actions.delete}
          >
            ✕
          </button>
          <div
            className={`${styles.toggleSwitch} ${task.enabled ? styles.on : ''}`}
            onClick={() => onToggleEnabled(task.id, !task.enabled)}
            role="switch"
            aria-checked={task.enabled}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onToggleEnabled(task.id, !task.enabled)}
          >
            <div className={styles.toggleKnob} />
          </div>
        </div>
      </div>

      <div className={styles.taskMeta}>
        <span className={styles.triggerBadge}>{triggerLabel}</span>
        {task.targetThreadId && (
          <span>
            {t.agent.automations.targetThread}: {task.targetThreadId.slice(0, 8)}…
          </span>
        )}
        {task.lastRunAt && (
          <span>
            {t.agent.automations.lastRun}: {new Date(task.lastRunAt).toLocaleString()}
          </span>
        )}
        <span>
          {t.agent.automations.nextRun}: {nextRunLabel}
        </span>
      </div>

      {task.runHistory.length > 0 && (
        <button
          type="button"
          className={styles.runHistoryToggle}
          onClick={() => onToggleHistory(task.id)}
        >
          {expanded ? t.agent.automations.hideHistory : t.agent.automations.showHistory} (
          {task.runHistory.length})
        </button>
      )}

      {expanded && task.runHistory.length > 0 && (
        <div className={styles.runHistory}>
          {task.runHistory.slice(0, 10).map((run, i) => (
            <RunItem key={`${run.runAt}-${i}`} run={run} t={t} />
          ))}
        </div>
      )}
    </div>
  );
});

// ── Run Item ───────────────────────────────────────────────────────────────

function RunItem({ run, t }: { run: AutomationRunRecord; t: ReturnType<typeof useTranslation> }) {
  const statusClass =
    run.status === 'succeeded'
      ? styles.succeeded
      : run.status === 'failed'
        ? styles.failed
        : styles.blocked;

  const statusLabel =
    run.status === 'succeeded'
      ? t.agent.automations.statusSucceeded
      : run.status === 'failed'
        ? t.agent.automations.statusFailed
        : t.agent.automations.statusBlocked;

  return (
    <div className={styles.runItem}>
      <span className={`${styles.runStatus} ${statusClass}`} />
      <span>{new Date(run.runAt).toLocaleString()}</span>
      <span>{statusLabel}</span>
      {run.summary && <span>— {run.summary}</span>}
    </div>
  );
}

// ── Task Form Dialog ───────────────────────────────────────────────────────

interface TaskFormDialogProps {
  t: ReturnType<typeof useTranslation>;
  projectPath: string;
  existingTask: AutomationTask | null;
  onSubmit: (
    payload: CreateAutomationTaskPayload | UpdateAutomationTaskPayload,
    isEdit: boolean,
    id?: string
  ) => void;
  onClose: () => void;
}

function TaskFormDialog({ t, projectPath, existingTask, onSubmit, onClose }: TaskFormDialogProps) {
  const isEdit = !!existingTask;

  const [name, setName] = useState(existingTask?.name ?? '');
  const [prompt, setPrompt] = useState(existingTask?.prompt ?? '');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(
    existingTask?.trigger.type ?? 'interval'
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    existingTask?.trigger.type === 'interval' ? String(existingTask.trigger.minutes) : '30'
  );
  const [cronExpression, setCronExpression] = useState(
    existingTask?.trigger.type === 'cron' ? existingTask.trigger.expression : '0 */6 * * *'
  );
  const [filePatterns, setFilePatterns] = useState(
    existingTask?.trigger.type === 'file_change'
      ? existingTask.trigger.patterns.join(', ')
      : '**/*.ts'
  );
  const [targetThreadId, setTargetThreadId] = useState(existingTask?.targetThreadId ?? '');
  const [accessMode, setAccessMode] = useState<AgentAccessMode>(
    existingTask?.accessMode ?? DEFAULT_AUTOMATION_ACCESS_MODE
  );

  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    let trigger: AutomationTrigger;
    switch (triggerType) {
      case 'interval':
        trigger = { type: 'interval', minutes: Math.max(1, parseInt(intervalMinutes, 10) || 30) };
        break;
      case 'cron':
        trigger = { type: 'cron', expression: cronExpression.trim() || '0 */6 * * *' };
        break;
      case 'file_change':
        trigger = {
          type: 'file_change',
          patterns: filePatterns
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
        };
        break;
    }

    if (isEdit && existingTask) {
      const patch: UpdateAutomationTaskPayload = {
        name: name.trim(),
        prompt: prompt.trim(),
        trigger,
        targetThreadId: targetThreadId.trim() || null,
        accessMode,
      };
      onSubmit(patch, true, existingTask.id);
    } else {
      const payload: CreateAutomationTaskPayload = {
        name: name.trim(),
        prompt: prompt.trim(),
        trigger,
        targetProjectPath: projectPath,
        targetThreadId: targetThreadId.trim() || null,
        accessMode,
        enabled: true,
      };
      onSubmit(payload, false);
    }
  }, [
    canSubmit,
    name,
    prompt,
    triggerType,
    intervalMinutes,
    cronExpression,
    filePatterns,
    targetThreadId,
    accessMode,
    isEdit,
    existingTask,
    projectPath,
    onSubmit,
  ]);

  return (
    <div
      className={styles.formOverlay}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.formPanel} role="dialog" aria-modal="true">
        <div className={styles.formHeader}>
          <span className={styles.title}>
            {isEdit ? t.agent.automations.editTask : t.agent.automations.createTask}
          </span>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.formBody}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t.agent.automations.taskName}</label>
            <input
              className={styles.fieldInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.agent.automations.taskNamePlaceholder}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t.agent.automations.triggerType}</label>
            <div className={styles.triggerTypeRow}>
              {(['interval', 'cron', 'file_change'] as AutomationTriggerType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.triggerTypeButton} ${triggerType === type ? styles.active : ''}`}
                  onClick={() => setTriggerType(type)}
                >
                  {type === 'interval'
                    ? t.agent.automations.triggerInterval
                    : type === 'cron'
                      ? t.agent.automations.triggerCron
                      : t.agent.automations.triggerFileChange}
                </button>
              ))}
            </div>
          </div>

          {triggerType === 'interval' && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t.agent.automations.intervalMinutes}</label>
              <input
                className={styles.fieldInput}
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
              />
            </div>
          )}

          {triggerType === 'cron' && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t.agent.automations.cronExpression}</label>
              <input
                className={styles.fieldInput}
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="0 */6 * * *"
              />
            </div>
          )}

          {triggerType === 'file_change' && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t.agent.automations.filePatterns}</label>
              <input
                className={styles.fieldInput}
                value={filePatterns}
                onChange={(e) => setFilePatterns(e.target.value)}
                placeholder="**/*.ts, **/*.tsx"
              />
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t.agent.automations.targetThread}</label>
            <input
              className={styles.fieldInput}
              value={targetThreadId}
              onChange={(e) => setTargetThreadId(e.target.value)}
              placeholder={t.agent.automations.targetThreadPlaceholder}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t.agent.automations.prompt}</label>
            <textarea
              className={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.agent.automations.promptPlaceholder}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t.agent.automations.accessMode}</label>
            <div className={styles.accessModeRow}>
              {(['read_only', 'auto', 'full_access'] as AgentAccessMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.accessModeButton} ${accessMode === mode ? styles.active : ''}`}
                  onClick={() => setAccessMode(mode)}
                >
                  {mode === 'read_only'
                    ? t.agent.automations.accessReadOnly
                    : mode === 'auto'
                      ? t.agent.automations.accessAuto
                      : t.agent.automations.accessFull}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.formFooter}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            {t.actions.cancel}
          </button>
          <button
            type="button"
            className={styles.submitButton}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {isEdit ? t.actions.confirm : t.actions.create}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Dialog ──────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  t: ReturnType<typeof useTranslation>;
  taskName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({ t, taskName, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  return (
    <div className={styles.deleteOverlay}>
      <div className={styles.deletePanel}>
        <div className={styles.deleteTitle}>{t.agent.automations.deleteConfirm}</div>
        <div className={styles.deleteMessage}>
          {t.agent.automations.deleteMessage.replace('{name}', taskName)}
        </div>
        <div className={styles.deleteActions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            {t.actions.cancel}
          </button>
          <button type="button" className={styles.deleteConfirmButton} onClick={onConfirm}>
            {t.actions.delete}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(AutomationsPanel);
