import { describe, expect, it, beforeEach } from 'vitest';
import type { SubagentRun } from '../../types/subagent';
import { toPersistedSubagentRun } from '../../types/subagent';
import { useSubagentStore } from '../../stores/useSubagentStore';
import {
  attachSubagentRunsSnapshot,
  collectSubagentRunsForToolCall,
  hydrateSubagentRunsFromConversationState,
} from './persistSubagentRuns';

function makeRun(id: string, status: SubagentRun['status']): SubagentRun {
  return {
    task: { id, description: `task ${id}` },
    status,
    startedAt: 1,
    finishedAt: status === 'running' || status === 'pending' ? undefined : 2,
    steps: 3,
    result:
      status === 'succeeded'
        ? {
            taskId: id,
            status: 'succeeded',
            summary: 'done',
          }
        : undefined,
  };
}

describe('persistSubagentRuns', () => {
  beforeEach(() => {
    useSubagentStore.setState({ runs: {} });
  });

  it('collectSubagentRunsForToolCall matches run_subagent by toolCallId', () => {
    const run = makeRun('tc-1', 'succeeded');
    useSubagentStore.setState({ runs: { 'tc-1': run } });

    const collected = collectSubagentRunsForToolCall('tc-1', 'run_subagent');
    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(toPersistedSubagentRun(run));
  });

  it('collectSubagentRunsForToolCall matches run_subagents by prefix', () => {
    const runA = makeRun('tc-2-0-abc', 'succeeded');
    const runB = makeRun('tc-2-1-def', 'failed');
    useSubagentStore.setState({
      runs: {
        'tc-2-0-abc': runA,
        'tc-2-1-def': runB,
        'other-task': makeRun('other-task', 'succeeded'),
      },
    });

    const collected = collectSubagentRunsForToolCall('tc-2', 'run_subagents');
    expect(collected).toHaveLength(2);
    expect(collected.map((r) => r.task.id).sort()).toEqual(['tc-2-0-abc', 'tc-2-1-def']);
  });

  it('attachSubagentRunsSnapshot writes subagentRuns onto tool message', () => {
    useSubagentStore.setState({ runs: { 'tc-3': makeRun('tc-3', 'succeeded') } });

    const message = attachSubagentRunsSnapshot(
      {
        id: 'm1',
        role: 'tool',
        text: 'ok',
        createdAt: 1,
        tool_call_id: 'tc-3',
      },
      'tc-3',
      'Agent'
    );

    expect(message.subagentRuns).toHaveLength(1);
    expect(message.subagentRuns?.[0].status).toBe('succeeded');
  });

  it('hydrateSubagentRunsFromConversationState restores runs from messages', () => {
    const persisted = toPersistedSubagentRun(makeRun('tc-4', 'succeeded'));
    hydrateSubagentRunsFromConversationState([
      {
        messages: [
          {
            id: 'm1',
            role: 'tool',
            text: 'ok',
            createdAt: 1,
            subagentRuns: [persisted],
          },
        ],
      },
    ]);

    expect(useSubagentStore.getState().runs['tc-4']?.status).toBe('succeeded');
    expect(useSubagentStore.getState().runs['tc-4']?.result?.summary).toBe('done');
  });

  it('hydrateRuns does not overwrite running live runs', () => {
    useSubagentStore.setState({
      runs: {
        'tc-5': makeRun('tc-5', 'running'),
      },
    });

    const persisted = toPersistedSubagentRun(makeRun('tc-5', 'succeeded'));
    useSubagentStore.getState().hydrateRuns([persisted]);

    expect(useSubagentStore.getState().runs['tc-5']?.status).toBe('running');
  });

  it('hydrateRuns overwrites terminal persisted snapshot when store is empty', () => {
    const persisted = toPersistedSubagentRun(makeRun('tc-6', 'failed'));
    useSubagentStore.getState().hydrateRuns([persisted]);

    expect(useSubagentStore.getState().runs['tc-6']?.status).toBe('failed');
  });
});
