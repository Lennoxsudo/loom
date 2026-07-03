import { describe, it, expect } from 'vitest';
import { resolveSubagentTimeline } from './subagentTimeline';
import type { SubagentRun } from '../../types/subagent';

describe('resolveSubagentTimeline', () => {
  it('returns timeline when present', () => {
    const run = {
      task: { id: '1', description: 't' },
      status: 'running' as const,
      timeline: [
        { kind: 'thinking' as const, id: 'a', text: 'plan' },
        { kind: 'tool' as const, id: 'b', toolName: 'read', status: 'done' as const },
      ],
    };
    expect(resolveSubagentTimeline(run)).toHaveLength(2);
  });

  it('builds legacy fallback from thinkingText + toolEvents', () => {
    const run: SubagentRun = {
      task: { id: '1', description: 't' },
      status: 'succeeded',
      thinkingText: 'legacy think',
      toolEvents: [
        { id: 't1', toolName: 'search', status: 'done', at: Date.now() },
      ],
    };
    const timeline = resolveSubagentTimeline(run);
    expect(timeline[0]).toMatchObject({ kind: 'thinking', text: 'legacy think' });
    expect(timeline[1]).toMatchObject({ kind: 'tool', toolName: 'search' });
  });
});
