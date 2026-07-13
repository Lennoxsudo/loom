import { describe, expect, it } from 'vitest';
import {
  buildCheckpointLabel,
  buildRestorePlan,
  collectPathsFromToolArgs,
  collectUserMessageIdsFromIndex,
  findEarliestCheckpointForUserTurns,
  isCheckpointMutatingTool,
  shortFileName,
  truncateCheckpointsAfterRestore,
  type AgentCheckpoint,
} from './checkpointTimeline';

function makeCp(
  id: string,
  createdAt: number,
  files: AgentCheckpoint['files']
): AgentCheckpoint {
  return {
    id,
    sessionKey: 's',
    projectPath: 'D:\\proj',
    toolName: 'write',
    label: id,
    createdAt,
    files,
  };
}

describe('checkpointTimeline', () => {
  it('detects mutating tools', () => {
    expect(isCheckpointMutatingTool('write')).toBe(true);
    expect(isCheckpointMutatingTool('edit_file')).toBe(true);
    expect(isCheckpointMutatingTool('delete_file')).toBe(true);
    expect(isCheckpointMutatingTool('read')).toBe(false);
  });

  it('builds labels', () => {
    expect(buildCheckpointLabel('write', ['src/App.tsx'])).toBe('write · App.tsx');
    expect(buildCheckpointLabel('edit', ['a.ts', 'b.ts'])).toBe('edit · a.ts +1');
    expect(shortFileName('D:\\proj\\src\\demo.ts')).toBe('demo.ts');
  });

  it('collects paths from tool args', () => {
    expect(collectPathsFromToolArgs('write', { path: 'a.ts' })).toEqual(['a.ts']);
    expect(collectPathsFromToolArgs('move_file', { source: 'a', destination: 'b' })).toEqual([
      'a',
      'b',
    ]);
  });

  it('builds restore plan from earliest snapshot per path', () => {
    const cps = [
      makeCp('c1', 1, [
        { path: 'A', existed: true, isBinary: false, byteLen: 1, blob: '1' },
      ]),
      makeCp('c2', 2, [
        { path: 'B', existed: false, isBinary: false, byteLen: 0, blob: '' },
      ]),
      makeCp('c3', 3, [
        { path: 'A', existed: true, isBinary: false, byteLen: 2, blob: '2' },
      ]),
    ];

    const plan = buildRestorePlan(cps, 'c2');
    expect(plan.size).toBe(2);
    expect(plan.get('b')?.existed).toBe(false);
    expect(plan.get('a')?.existed).toBe(true);
  });

  it('truncates from target inclusive', () => {
    const cps = [
      makeCp('c1', 1, []),
      makeCp('c2', 2, []),
      makeCp('c3', 3, []),
    ];
    const next = truncateCheckpointsAfterRestore(cps, 'c2');
    expect(next.map((c) => c.id)).toEqual(['c1']);
  });

  it('finds earliest checkpoint for user turns', () => {
    const cps: AgentCheckpoint[] = [
      { ...makeCp('c1', 10, []), userMessageId: 'u1' },
      { ...makeCp('c2', 20, []), userMessageId: 'u2' },
      { ...makeCp('c3', 30, []), userMessageId: 'u2' },
    ];
    expect(findEarliestCheckpointForUserTurns(cps, ['u2'])?.id).toBe('c2');
    expect(findEarliestCheckpointForUserTurns(cps, ['u1', 'u2'])?.id).toBe('c1');
    expect(
      collectUserMessageIdsFromIndex(
        [
          { id: 'a', role: 'assistant' },
          { id: 'u1', role: 'user' },
          { id: 'a2', role: 'assistant' },
          { id: 'u2', role: 'user' },
        ],
        1
      )
    ).toEqual(['u1', 'u2']);
  });
});
