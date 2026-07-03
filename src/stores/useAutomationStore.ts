/**
 * Automation Store - Zustand store for managing scheduled / background tasks.
 *
 * Persists via the Rust backend (agent_automation_* commands).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type {
  AutomationTask,
  AutomationRunRecord,
  CreateAutomationTaskPayload,
  UpdateAutomationTaskPayload,
  AutomationTrigger,
} from '../types/automation';
import type { AgentAccessMode } from '../types/settings';

const MAX_RUN_HISTORY = 50;

interface AutomationState {
  tasks: AutomationTask[];
  loading: boolean;
}

interface AutomationActions {
  setLoading: (loading: boolean) => void;
  loadTasks: () => Promise<void>;
  createTask: (payload: CreateAutomationTaskPayload) => Promise<AutomationTask>;
  updateTask: (id: string, patch: UpdateAutomationTaskPayload) => Promise<AutomationTask>;
  deleteTask: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  recordRun: (id: string, status: AutomationRunRecord['status'], summary?: string) => Promise<void>;
}

export type AutomationStore = AutomationState & AutomationActions;

export const useAutomationStore = create<AutomationStore>()(
  devtools(
    (set, _get) => ({
      tasks: [],
      loading: false,

      setLoading: (loading) => set({ loading }),

      loadTasks: async () => {
        set({ loading: true });
        try {
          const tasks = await invoke<AutomationTask[]>('agent_automation_list');
          set({ tasks, loading: false });
        } catch {
          set({ loading: false });
        }
      },

      createTask: async (payload) => {
        const task = await invoke<AutomationTask>('agent_automation_create', { payload });
        set((state) => ({ tasks: [task, ...state.tasks] }));
        return task;
      },

      updateTask: async (id, patch) => {
        const updated = await invoke<AutomationTask>('agent_automation_update', { id, patch });
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        }));
        return updated;
      },

      deleteTask: async (id) => {
        await invoke('agent_automation_delete', { id });
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
      },

      setEnabled: async (id, enabled) => {
        const updated = await invoke<AutomationTask>('agent_automation_set_enabled', { id, enabled });
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        }));
      },

      runNow: async (id) => {
        await invoke('agent_automation_run_now', { id });
      },

      recordRun: async (id, status, summary) => {
        const runAt = new Date().toISOString();
        const record: AutomationRunRecord = { runAt, status, summary };
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const runHistory = [record, ...t.runHistory].slice(0, MAX_RUN_HISTORY);
            return { ...t, lastRunAt: runAt, runHistory, updatedAt: runAt };
          }),
        }));
        // Persist the run history update
        try {
          await invoke('agent_automation_record_run', { id, record });
        } catch {
          // Non-critical: the in-memory state is already updated
        }
      },
    }),
    { name: 'AutomationStore' }
  )
);

// ── Selectors ──────────────────────────────────────────────────────────────

export const useAutomationTasks = () => useAutomationStore((s) => s.tasks);
export const useAutomationLoading = () => useAutomationStore((s) => s.loading);
export const useAutomationActions = () =>
  useAutomationStore((s) => ({
    loadTasks: s.loadTasks,
    createTask: s.createTask,
    updateTask: s.updateTask,
    deleteTask: s.deleteTask,
    setEnabled: s.setEnabled,
    runNow: s.runNow,
    recordRun: s.recordRun,
  }));

// ── Helpers ────────────────────────────────────────────────────────────────

/** Default access mode for new automation tasks (more conservative) */
export const DEFAULT_AUTOMATION_ACCESS_MODE: AgentAccessMode = 'auto';

/** Generate a simple unique ID */
export function generateAutomationId(): string {
  return `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Compute the next run timestamp for interval/cron triggers.
 *  For cron, relies on the backend-computed nextRunAt field stored on the task.
 */
export function computeNextRunAt(
  trigger: AutomationTrigger,
  lastRunAt?: string,
  backendNextRunAt?: string,
): string | undefined {
  if (trigger.type === 'interval') {
    const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
    return new Date(base + trigger.minutes * 60_000).toISOString();
  }
  if (trigger.type === 'cron') {
    // Use the backend-computed nextRunAt; cron scheduling is handled by the Rust scheduler
    return backendNextRunAt;
  }
  // file_change triggers don't have a predictable next run
  return undefined;
}
