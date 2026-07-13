import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  AgentCheckpoint,
  CheckpointCreateInput,
  CheckpointRestoreResult,
} from '../utils/checkpointTimeline';
import {
  clearCheckpointSession,
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
} from '../utils/checkpointService';
import { truncateCheckpointsAfterRestore } from '../utils/checkpointTimeline';

/** Stable empty list so Zustand selectors don't thrash on `?? []`. */
export const EMPTY_CHECKPOINTS: AgentCheckpoint[] = [];

interface CheckpointState {
  /** sessionKey -> ordered checkpoints */
  bySession: Record<string, AgentCheckpoint[]>;
  restoringId: string | null;
  lastError: string | null;

  setSessionCheckpoints: (sessionKey: string, checkpoints: AgentCheckpoint[]) => void;
  hydrateSession: (sessionKey: string) => Promise<void>;
  addCheckpoint: (input: CheckpointCreateInput) => Promise<AgentCheckpoint | null>;
  restoreToCheckpoint: (options: {
    sessionKey: string;
    checkpointId: string;
    projectPath: string;
  }) => Promise<CheckpointRestoreResult | null>;
  clearSession: (sessionKey: string) => Promise<void>;
  clearError: () => void;
}

function sameCheckpointIds(a: AgentCheckpoint[], b: AgentCheckpoint[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id || a[i]?.createdAt !== b[i]?.createdAt) return false;
  }
  return true;
}

export const useCheckpointStore = create<CheckpointState>()(
  devtools(
    (set, get) => ({
      bySession: {},
      restoringId: null,
      lastError: null,

      setSessionCheckpoints: (sessionKey, checkpoints) => {
        set((state) => {
          const sorted =
            checkpoints.length === 0
              ? EMPTY_CHECKPOINTS
              : [...checkpoints].sort((a, b) => a.createdAt - b.createdAt);
          const prev = state.bySession[sessionKey] ?? EMPTY_CHECKPOINTS;
          if (sameCheckpointIds(prev, sorted)) {
            return state;
          }
          return {
            bySession: {
              ...state.bySession,
              [sessionKey]: sorted,
            },
          };
        });
      },

      hydrateSession: async (sessionKey) => {
        if (!sessionKey.trim()) return;
        try {
          const list = await listCheckpoints(sessionKey);
          get().setSessionCheckpoints(sessionKey, list);
        } catch {
          // Tauri unavailable / no disk session — leave existing in-memory state alone.
        }
      },

      addCheckpoint: async (input) => {
        try {
          const record = await createCheckpoint(input);
          set((state) => {
            const prev = state.bySession[input.sessionKey] ?? [];
            const next = [...prev.filter((c) => c.id !== record.id), record].sort(
              (a, b) => a.createdAt - b.createdAt
            );
            return {
              bySession: { ...state.bySession, [input.sessionKey]: next },
              lastError: null,
            };
          });
          return record;
        } catch (error) {
          set({ lastError: String(error) });
          return null;
        }
      },

      restoreToCheckpoint: async ({ sessionKey, checkpointId, projectPath }) => {
        set({ restoringId: checkpointId, lastError: null });
        try {
          const result = await restoreCheckpoint({ sessionKey, checkpointId, projectPath });
          if (result.success) {
            set((state) => {
              const prev = state.bySession[sessionKey] ?? [];
              const next = truncateCheckpointsAfterRestore(prev, checkpointId);
              return {
                bySession: { ...state.bySession, [sessionKey]: next },
                restoringId: null,
              };
            });
          } else {
            set({ restoringId: null, lastError: result.message });
          }
          return result;
        } catch (error) {
          set({ restoringId: null, lastError: String(error) });
          return null;
        }
      },

      clearSession: async (sessionKey) => {
        try {
          await clearCheckpointSession(sessionKey);
        } catch {
          // Best-effort disk clear
        }
        set((state) => {
          const next = { ...state.bySession };
          delete next[sessionKey];
          return { bySession: next };
        });
      },

      clearError: () => set({ lastError: null }),
    }),
    { name: 'CheckpointStore' }
  )
);

export function selectSessionCheckpoints(
  state: CheckpointState,
  sessionKey: string | null | undefined
): AgentCheckpoint[] {
  if (!sessionKey) return EMPTY_CHECKPOINTS;
  return state.bySession[sessionKey] ?? EMPTY_CHECKPOINTS;
}
