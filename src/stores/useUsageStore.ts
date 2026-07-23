/**
 * Usage Store
 *
 * Tracks cumulative token usage + estimated USD cost across the whole app,
 * broken down by session (conversation) and by model. Counts are accumulated
 * on the frontend from the real `usage` reported on `ai-stream-complete`
 * (see useAgentStreamEvents / runAgentLoop), and persisted to disk via the
 * `save_usage` / `load_usage` Tauri commands (mirrors the settings store:
 * no `persist` middleware, manual Tauri invokes).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { computeCost, getModelPricing, modelKey, type UsageTokens } from '../utils/pricing';
import { useSettingsStore } from './useSettingsStore';

export interface UsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface SessionUsageEntry extends UsageEntry {
  updatedAt: number;
}

export interface UsageState {
  total: UsageEntry;
  sessions: Record<string, SessionUsageEntry>;
  byModel: Record<string, UsageEntry>;
}

export interface AddUsagePayload extends UsageTokens {
  sessionKey?: string;
  provider?: string;
  model?: string;
  /** When true, record token counts only and skip USD cost computation. */
  skipCost?: boolean;
}

interface UsageActions {
  addUsage: (payload: AddUsagePayload) => void;
  reset: () => void;
  hydrate: (
    data: Partial<{
      total: UsageEntry;
      sessions: Record<string, SessionUsageEntry>;
      byModel: Record<string, UsageEntry>;
    }>
  ) => void;
  initUsage: () => Promise<void>;
}

type UsageStore = UsageState & UsageActions;

function emptyEntry(): UsageEntry {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function addEntries(a: UsageEntry, b: UsageEntry): UsageEntry {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

function entryFromPayload(payload: AddUsagePayload): UsageEntry {
  const pricing = getModelPricing(payload.provider ?? '', payload.model ?? '');
  const cost = payload.skipCost ? 0 : computeCost(payload, pricing);
  return {
    inputTokens: payload.input ?? 0,
    outputTokens: payload.output ?? 0,
    cacheReadTokens: payload.cacheRead ?? 0,
    cacheWriteTokens: payload.cacheWrite ?? 0,
    costUsd: cost,
  };
}

const FLUSH_DELAY_MS = 1500;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(get: () => UsageStore): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const { total, sessions, byModel } = get();
    const payload = JSON.stringify({ total, sessions, byModel });
    if (isTauri()) {
      invoke('save_usage', { usage: payload }).catch(() => {
        /* best-effort persistence; ignore failures */
      });
    }
  }, FLUSH_DELAY_MS);
}

export const useUsageStore = create<UsageStore>()(
  devtools(
    (set, get) => ({
      total: emptyEntry(),
      sessions: {},
      byModel: {},

      addUsage: (payload) => {
        // Respect the master "record usage" switch — when disabled, do not
        // accumulate or persist any token/cost data.
        if (!useSettingsStore.getState().enableUsageTracking) return;
        const entry = entryFromPayload(payload);
        set((state) => {
          const total = addEntries(state.total, entry);
          let sessions = state.sessions;
          if (payload.sessionKey) {
            const prev = state.sessions[payload.sessionKey] ?? emptyEntry();
            sessions = {
              ...state.sessions,
              [payload.sessionKey]: { ...addEntries(prev, entry), updatedAt: Date.now() },
            };
          }
          const key = modelKey(payload.provider, payload.model);
          const prevModel = state.byModel[key] ?? emptyEntry();
          const byModel = { ...state.byModel, [key]: addEntries(prevModel, entry) };
          return { total, sessions, byModel };
        });
        scheduleFlush(get);
      },

      reset: () => {
        set({ total: emptyEntry(), sessions: {}, byModel: {} });
        if (isTauri()) {
          invoke('save_usage', {
            usage: JSON.stringify({ total: emptyEntry(), sessions: {}, byModel: {} }),
          }).catch(() => {
            /* ignore */
          });
        }
      },

      hydrate: (data) => {
        set({
          total: data.total ?? emptyEntry(),
          sessions: data.sessions ?? {},
          byModel: data.byModel ?? {},
        });
      },

      initUsage: async () => {
        if (!isTauri()) return;
        try {
          const raw = await invoke<string>('load_usage');
          const data = JSON.parse(raw) as Partial<{
            total: UsageEntry;
            sessions: Record<string, SessionUsageEntry>;
            byModel: Record<string, UsageEntry>;
          }>;
          if (data && (data.total || data.sessions || data.byModel)) {
            get().hydrate(data);
          }
        } catch {
          /* no persisted data yet — start from zero */
        }
      },
    }),
    { name: 'UsageStore' }
  )
);

// --- Selector hooks (granular subscriptions) ---
export const useUsageTotals = (): UsageEntry => useUsageStore((s) => s.total);
export const useSessionUsage = (id?: string): SessionUsageEntry | undefined =>
  useUsageStore((s) => (id ? s.sessions[id] : undefined));
export const useUsageByModel = (): Record<string, UsageEntry> => useUsageStore((s) => s.byModel);
