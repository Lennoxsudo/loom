import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { SubagentRun, SubagentTask, SubagentResult, SubagentRunStatus, PersistedSubagentRun } from '../types/subagent';
import { persistedSubagentRunToSubagentRun } from '../types/subagent';

const runControllers = new Map<string, AbortController>();

interface SubagentState {
  runs: Record<string, SubagentRun>;

  startSubagent: (task: SubagentTask) => void;
  updateSubagentStatus: (id: string, status: SubagentRunStatus, steps?: number) => void;
  finishSubagent: (id: string, result: SubagentResult) => void;
  clearSubagent: (id: string) => void;
  appendStreamChunk: (id: string, chunk: string) => void;
  appendThinking: (id: string, chunk: string) => void;
  pushToolEvent: (
    id: string,
    event: { id: string; toolName: string; status: 'running' | 'done' | 'error'; resultPreview?: string }
  ) => void;
  updateToolEvent: (
    id: string,
    eventId: string,
    patch: Partial<{ status: 'running' | 'done' | 'error'; resultPreview?: string }>
  ) => void;

  cancelSubagent: (id: string) => void;
  cancelAllSubagents: () => void;
  registerController: (id: string, controller: AbortController) => void;
  removeController: (id: string) => void;
  setPendingApproval: (
    id: string,
    req: { toolName: string; detailPreview: string; resolve: (choice: 'approve' | 'reject') => void }
  ) => void;
  clearPendingApproval: (id: string) => void;
  hydrateRuns: (records: PersistedSubagentRun[]) => void;
}

export const useSubagentStore = create<SubagentState>()(
  devtools(
    (set) => ({
      runs: {},

      startSubagent: (task: SubagentTask) => {
        set((state) => {
          const existing = state.runs[task.id];
          const base = existing ?? {
            status: 'pending' as const,
            startedAt: Date.now(),
            streamingText: '',
            thinkingText: '',
            timeline: [],
            toolEvents: [],
          };
          return {
            runs: {
              ...state.runs,
              [task.id]: {
                ...base,
                task: existing ? { ...existing.task, ...task } : task,
                status: existing?.status === 'running' ? existing.status : base.status,
              },
            },
          };
        });
      },

      updateSubagentStatus: (id: string, status: SubagentRunStatus, steps?: number) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                status,
                ...(steps !== undefined ? { steps } : {}),
                ...(status === 'running' && !run.startedAt ? { startedAt: Date.now() } : {}),
              },
            },
          };
        });
      },

      finishSubagent: (id: string, result: SubagentResult) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                status: result.status,
                finishedAt: Date.now(),
                result,
              },
            },
          };
        });
      },

      clearSubagent: (id: string) => {
        set((state) => {
          const { [id]: _, ...rest } = state.runs;
          return { runs: rest };
        });
      },

      appendStreamChunk: (id: string, chunk: string) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                streamingText: (run.streamingText || '') + chunk,
              },
            },
          };
        });
      },

      appendThinking: (id: string, chunk: string) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          const timeline = run.timeline ? [...run.timeline] : [];
          const last = timeline[timeline.length - 1];
          if (last?.kind === 'thinking') {
            timeline[timeline.length - 1] = { ...last, text: last.text + chunk };
          } else {
            timeline.push({
              kind: 'thinking',
              id: `think-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              text: chunk,
            });
          }
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                thinkingText: (run.thinkingText || '') + chunk,
                timeline,
              },
            },
          };
        });
      },

      pushToolEvent: (id, event) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          const toolEvents = run.toolEvents ? [...run.toolEvents] : [];
          const timeline = run.timeline ? [...run.timeline] : [];
          if (!toolEvents.some((e) => e.id === event.id)) {
            toolEvents.push({
              ...event,
              at: Date.now(),
            });
            timeline.push({
              kind: 'tool',
              id: event.id,
              toolName: event.toolName,
              status: event.status,
              resultPreview: event.resultPreview,
            });
          }
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                toolEvents,
                timeline,
              },
            },
          };
        });
      },

      updateToolEvent: (id, eventId, patch) => {
        set((state) => {
          const run = state.runs[id];
          if (!run || !run.toolEvents) return state;
          const toolEvents = run.toolEvents.map((e) => {
            if (e.id !== eventId) return e;
            return {
              ...e,
              ...patch,
            };
          });
          const timeline = (run.timeline ?? []).map((entry) => {
            if (entry.kind !== 'tool' || entry.id !== eventId) return entry;
            return {
              ...entry,
              ...patch,
            };
          });
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                toolEvents,
                timeline,
              },
            },
          };
        });
      },

      cancelSubagent: (id: string) => {
        const controller = runControllers.get(id);
        if (controller) {
          controller.abort();
          runControllers.delete(id);
        }
      },

      cancelAllSubagents: () => {
        for (const controller of runControllers.values()) {
          controller.abort();
        }
        runControllers.clear();
      },

      registerController: (id: string, controller: AbortController) => {
        runControllers.set(id, controller);
      },

      removeController: (id: string) => {
        runControllers.delete(id);
      },

      setPendingApproval: (id, req) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          return {
            runs: {
              ...state.runs,
              [id]: {
                ...run,
                pendingApproval: req,
              },
            },
          };
        });
      },

      clearPendingApproval: (id) => {
        set((state) => {
          const run = state.runs[id];
          if (!run) return state;
          const { pendingApproval, ...rest } = run;
          return {
            runs: {
              ...state.runs,
              [id]: rest,
            },
          };
        });
      },

      hydrateRuns: (records: PersistedSubagentRun[]) => {
        if (records.length === 0) return;
        set((state) => {
          const runs = { ...state.runs };
          for (const record of records) {
            const id = record.task.id;
            const existing = runs[id];
            if (existing && (existing.status === 'running' || existing.status === 'pending')) {
              continue;
            }
            runs[id] = persistedSubagentRunToSubagentRun(record);
          }
          return { runs };
        });
      },
    }),
    { name: 'SubagentStore' }
  )
);

// Selectors
export const useSubagentRuns = () => useSubagentStore((state) => state.runs);
export const useStartSubagent = () => useSubagentStore((state) => state.startSubagent);
export const useUpdateSubagentStatus = () => useSubagentStore((state) => state.updateSubagentStatus);
export const useFinishSubagent = () => useSubagentStore((state) => state.finishSubagent);
export const useClearSubagent = () => useSubagentStore((state) => state.clearSubagent);
export const useAppendStreamChunk = () => useSubagentStore((state) => state.appendStreamChunk);
export const useAppendThinking = () => useSubagentStore((state) => state.appendThinking);
export const usePushToolEvent = () => useSubagentStore((state) => state.pushToolEvent);
export const useUpdateToolEvent = () => useSubagentStore((state) => state.updateToolEvent);
export const useCancelSubagent = () => useSubagentStore((state) => state.cancelSubagent);
export const useCancelAllSubagents = () => useSubagentStore((state) => state.cancelAllSubagents);
export const useHydrateSubagentRuns = () => useSubagentStore((state) => state.hydrateRuns);

