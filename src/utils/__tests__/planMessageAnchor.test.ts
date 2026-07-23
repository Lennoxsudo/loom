import { describe, it, expect } from 'vitest';
import { findPlanAnchorMessageId, insertAfterMessageAnchor } from '../planMessageAnchor';

describe('planMessageAnchor', () => {
  it('finds last update_plan / exit_plan_mode tool message', () => {
    const id = findPlanAnchorMessageId([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 't1', role: 'tool', tool_name: 'read' },
      { id: 't2', role: 'tool', tool_name: 'update_plan' },
      { id: 't3', role: 'tool', tool_name: 'exit_plan_mode' },
      { id: 'u2', role: 'user' },
    ]);
    expect(id).toBe('t3');
  });

  it('falls back to last message when no plan tools', () => {
    expect(
      findPlanAnchorMessageId([
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
      ])
    ).toBe('a1');
  });

  it('inserts plan after tool_group that contains the anchor', () => {
    const items = [
      { id: 'u1' },
      { type: 'tool_group', id: 'g1', messages: [{ id: 't1' }, { id: 't2' }] },
      { id: 'u2' },
    ];
    const next = insertAfterMessageAnchor(items, { type: 'plan_document', id: 'plan' }, 't2');
    expect(next.map((x) => x.id)).toEqual(['u1', 'g1', 'plan', 'u2']);
  });

  it('keeps subsequent messages after the plan', () => {
    const items = [
      { kind: 'msg', message: { id: 'u1' } },
      { kind: 'msg', message: { id: 't-plan' } },
      { kind: 'msg', message: { id: 'u2' } },
    ];
    const next = insertAfterMessageAnchor(
      items as never[],
      { kind: 'plan', id: 'plan' } as never,
      't-plan'
    );
    // Insert AFTER the anchor: [u1, t-plan, plan, u2]
    expect((next[0] as { message: { id: string } }).message.id).toBe('u1');
    expect((next[1] as { message: { id: string } }).message.id).toBe('t-plan');
    expect((next[2] as { kind: string }).kind).toBe('plan');
    expect((next[3] as { message: { id: string } }).message.id).toBe('u2');
  });
});
