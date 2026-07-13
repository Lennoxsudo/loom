import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getToolHandler } from '../registry';
import { clearPlan, peekPlan } from '../planStore';

describe('planningHandlers plan tools', () => {
  const conversationId = 'plan-handler-test-conv';

  beforeEach(() => {
    clearPlan(conversationId);
  });

  it('update_plan stores draft plan document', async () => {
    const handler = getToolHandler('update_plan');
    expect(handler).toBeDefined();
    const result = await handler!.execute(
      { plan: '## Goals\n- ship it', title: 'Ship' },
      { conversationId },
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Plan document updated');
    const stored = peekPlan(conversationId);
    expect(stored.content).toContain('ship it');
    expect(stored.title).toBe('Ship');
    expect(stored.status).toBe('draft');
  });

  it('exit_plan_mode requires plan content', async () => {
    const handler = getToolHandler('exit_plan_mode');
    const result = await handler!.execute({}, { conversationId });
    expect(result.error).toBeTruthy();
  });

  it('exit_plan_mode presents plan non-blocking and ends the turn', async () => {
    const handler = getToolHandler('exit_plan_mode');
    const onExitPlanMode = vi.fn().mockResolvedValue(undefined);

    const result = await handler!.execute(
      { plan: '1. Do work\n2. Verify', title: 'Accepted plan' },
      { conversationId, agentId: 'agent-1', onExitPlanMode },
    );

    expect(onExitPlanMode).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        agentId: 'agent-1',
        plan: '1. Do work\n2. Verify',
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('human review');
    expect(result.output).toContain('END');
    expect(result.output).toContain('[PLAN]');
    // Does not wait for accept — status stays pending_review
    expect(peekPlan(conversationId).status).toBe('pending_review');
  });

  it('exit_plan_mode can use plan from prior update_plan', async () => {
    const update = getToolHandler('update_plan');
    await update!.execute({ plan: 'Stored plan body' }, { conversationId });

    const exit = getToolHandler('exit_plan_mode');
    const onExitPlanMode = vi.fn();
    const result = await exit!.execute({}, { conversationId, onExitPlanMode });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Stored plan body');
    expect(peekPlan(conversationId).status).toBe('pending_review');
    expect(onExitPlanMode).toHaveBeenCalled();
  });
});
