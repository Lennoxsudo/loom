import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useSubagentStore } from '../../../stores/useSubagentStore';
import {
  SUBAGENT_DISABLED_SUMMARY,
  buildSubagentDisabledResult,
  isSubagentsEnabled,
} from '../bootstrap';
import { spawnSubagent } from '../spawn';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('{}'),
}));

const runAgentLoopMock = vi.fn();
vi.mock('../../runAgentLoop', () => ({
  runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args),
}));

describe('subagent feature flag bootstrap helpers', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enableSubagents: false });
    useSubagentStore.setState({ runs: {} });
    vi.clearAllMocks();
  });

  it('isSubagentsEnabled returns false by default', () => {
    expect(isSubagentsEnabled()).toBe(false);
  });

  it('buildSubagentDisabledResult returns succeeded status with disable summary', () => {
    const result = buildSubagentDisabledResult('task-1');
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'succeeded',
      summary: SUBAGENT_DISABLED_SUMMARY,
    });
  });

  it('spawnSubagent returns disabled result without calling runAgentLoop when flag is off', async () => {
    const result = await spawnSubagent({
      taskId: 'task-disabled',
      prompt: 'Do work',
      subagentType: 'general-purpose',
      parentProvider: 'openai',
      parentModel: 'gpt-4o',
    });

    expect(result.status).toBe('succeeded');
    expect(result.summary).toBe(SUBAGENT_DISABLED_SUMMARY);
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(Object.keys(useSubagentStore.getState().runs)).toHaveLength(0);
  });

  it('spawnSubagent proceeds when enableSubagents is true', async () => {
    useSettingsStore.setState({ enableSubagents: true });
    runAgentLoopMock.mockResolvedValue({ finalText: 'done', steps: 1 });

    const result = await spawnSubagent({
      taskId: 'task-enabled',
      prompt: 'Do work',
      subagentType: 'general-purpose',
      parentProvider: 'openai',
      parentModel: 'gpt-4o',
    });

    expect(runAgentLoopMock).toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });
});
