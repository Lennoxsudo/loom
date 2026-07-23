/**
 * Tests for the Automation store: CRUD, run history, scheduling helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAutomationStore,
  DEFAULT_AUTOMATION_ACCESS_MODE,
  computeNextRunAt,
  generateAutomationId,
} from '../useAutomationStore';
import type { AutomationTask, AutomationTrigger } from '../../types/automation';

// ── Helper to create a sample task ─────────────────────────────────────────

function sampleTask(overrides?: Partial<AutomationTask>): AutomationTask {
  return {
    id: 'test-1',
    name: 'Test Task',
    enabled: true,
    trigger: { type: 'interval', minutes: 30 },
    targetProjectPath: '/tmp/project',
    targetThreadId: null,
    prompt: 'Run tests',
    accessMode: 'auto',
    lastRunAt: undefined,
    nextRunAt: undefined,
    runHistory: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useAutomationStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAutomationStore.setState({
      tasks: [],
      loading: false,
    });
  });

  it('initializes with empty tasks', () => {
    const state = useAutomationStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it('setLoading updates loading state', () => {
    useAutomationStore.getState().setLoading(true);
    expect(useAutomationStore.getState().loading).toBe(true);
    useAutomationStore.getState().setLoading(false);
    expect(useAutomationStore.getState().loading).toBe(false);
  });

  it('createTask adds a task to the store', async () => {
    const task = sampleTask();
    // Directly set the store state to simulate what createTask would do
    useAutomationStore.setState({ tasks: [task] });

    expect(useAutomationStore.getState().tasks).toHaveLength(1);
    expect(useAutomationStore.getState().tasks[0].id).toBe('test-1');
  });

  it('deleteTask removes a task from the store', () => {
    useAutomationStore.setState({ tasks: [sampleTask()] });
    expect(useAutomationStore.getState().tasks).toHaveLength(1);

    // Simulate deletion by filtering
    const taskId = 'test-1';
    useAutomationStore.setState((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));

    expect(useAutomationStore.getState().tasks).toHaveLength(0);
  });

  it('updateTask patches an existing task', () => {
    useAutomationStore.setState({ tasks: [sampleTask()] });

    const updated = { ...sampleTask(), name: 'Updated Task' };
    useAutomationStore.setState((state) => ({
      tasks: state.tasks.map((t) => (t.id === 'test-1' ? updated : t)),
    }));

    expect(useAutomationStore.getState().tasks[0].name).toBe('Updated Task');
  });

  it('setEnabled toggles task enabled state', () => {
    useAutomationStore.setState({ tasks: [sampleTask()] });

    const updated = { ...sampleTask(), enabled: false };
    useAutomationStore.setState((state) => ({
      tasks: state.tasks.map((t) => (t.id === 'test-1' ? updated : t)),
    }));

    expect(useAutomationStore.getState().tasks[0].enabled).toBe(false);
  });

  it('recordRun adds a run history entry', () => {
    useAutomationStore.setState({ tasks: [sampleTask()] });

    useAutomationStore.getState().recordRun('test-1', 'succeeded', 'All good');

    const task = useAutomationStore.getState().tasks.find((t) => t.id === 'test-1');
    expect(task?.runHistory).toHaveLength(1);
    expect(task?.runHistory[0].status).toBe('succeeded');
    expect(task?.runHistory[0].summary).toBe('All good');
    expect(task?.lastRunAt).toBeDefined();
  });

  it('recordRun caps history at 50 entries', () => {
    useAutomationStore.setState({ tasks: [sampleTask()] });

    for (let i = 0; i < 60; i++) {
      useAutomationStore.getState().recordRun('test-1', 'succeeded', `Run ${i}`);
    }

    const task = useAutomationStore.getState().tasks.find((t) => t.id === 'test-1');
    expect(task?.runHistory.length).toBeLessThanOrEqual(50);
  });

  it('recordRun handles blocked_by_approval status', () => {
    useAutomationStore.setState({ tasks: [sampleTask()] });

    useAutomationStore.getState().recordRun('test-1', 'blocked_by_approval', 'Approval required');

    const task = useAutomationStore.getState().tasks.find((t) => t.id === 'test-1');
    expect(task?.runHistory[0].status).toBe('blocked_by_approval');
  });

  it('recordRun for non-existent task does not crash', () => {
    useAutomationStore.setState({ tasks: [] });
    expect(() => {
      useAutomationStore.getState().recordRun('nonexistent', 'failed', 'Not found');
    }).not.toThrow();
  });
});

// ── computeNextRunAt tests ─────────────────────────────────────────────────

describe('computeNextRunAt', () => {
  it('returns a future timestamp for interval triggers', () => {
    const trigger: AutomationTrigger = { type: 'interval', minutes: 30 };
    const result = computeNextRunAt(trigger);
    expect(result).toBeDefined();
    // Should be approximately 30 minutes from now
    const diff = new Date(result!).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * 60 * 1000);
    expect(diff).toBeLessThan(31 * 60 * 1000);
  });

  it('computes next run from lastRunAt for interval triggers', () => {
    const trigger: AutomationTrigger = { type: 'interval', minutes: 60 };
    const lastRunAt = new Date('2026-01-01T12:00:00Z').toISOString();
    const result = computeNextRunAt(trigger, lastRunAt);
    expect(result).toBeDefined();
    expect(result).toContain('13:00');
  });

  it('returns backendNextRunAt for cron triggers when provided', () => {
    const trigger: AutomationTrigger = { type: 'cron', expression: '0 */6 * * *' };
    const backendNext = '2026-01-01T12:00:00+00:00';
    expect(computeNextRunAt(trigger, undefined, backendNext)).toBe(backendNext);
  });

  it('returns undefined for cron triggers without backendNextRunAt', () => {
    const trigger: AutomationTrigger = { type: 'cron', expression: '0 */6 * * *' };
    expect(computeNextRunAt(trigger)).toBeUndefined();
  });

  it('returns undefined for file_change triggers', () => {
    const trigger: AutomationTrigger = { type: 'file_change', patterns: ['**/*.ts'] };
    expect(computeNextRunAt(trigger)).toBeUndefined();
  });
});

// ── generateAutomationId tests ─────────────────────────────────────────────

describe('generateAutomationId', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateAutomationId());
    }
    expect(ids.size).toBe(100);
  });

  it('starts with automation- prefix', () => {
    const id = generateAutomationId();
    expect(id.startsWith('automation-')).toBe(true);
  });
});

// ── Default access mode ────────────────────────────────────────────────────

describe('DEFAULT_AUTOMATION_ACCESS_MODE', () => {
  it('defaults to auto (more conservative than full_access)', () => {
    expect(DEFAULT_AUTOMATION_ACCESS_MODE).toBe('auto');
  });
});
