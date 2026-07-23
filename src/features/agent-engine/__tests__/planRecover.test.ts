import { describe, it, expect } from 'vitest';
import { recoverPlanFromMessages } from '../planRecover';

describe('recoverPlanFromMessages', () => {
  it('recovers plan from exit_plan_mode tool args', () => {
    const plan = recoverPlanFromMessages([
      { role: 'user', text: 'plan this' },
      {
        role: 'tool',
        tool_name: 'update_plan',
        tool_args: { plan: '# Draft\nstep 1', title: 'Draft' },
        text: 'Plan document updated',
      },
      {
        role: 'tool',
        tool_name: 'exit_plan_mode',
        tool_args: { plan: '# Final plan\n- do x', title: 'Final plan' },
        text: 'Plan submitted\n[PLAN]\n# Final plan\n\n- do x\n[End PLAN]',
      },
    ]);
    expect(plan).not.toBeNull();
    expect(plan?.content).toContain('do x');
    expect(plan?.title).toBe('Final plan');
    expect(plan?.status).toBe('pending_review');
  });

  it('marks accepted when conversation continued after exit_plan_mode', () => {
    const plan = recoverPlanFromMessages([
      {
        role: 'tool',
        tool_name: 'exit_plan_mode',
        tool_args: { plan: '# Done\nwork', title: 'Done' },
        text: '',
      },
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '你好！' },
    ]);
    expect(plan?.status).toBe('accepted');
    expect(plan?.content).toContain('work');
  });

  it('recovers from [PLAN] block when tool_args.plan is missing', () => {
    const plan = recoverPlanFromMessages([
      {
        role: 'tool',
        tool_name: 'exit_plan_mode',
        text: [
          'Plan submitted for human review.',
          '',
          '[PLAN]',
          '# 给 README 增加安装说明',
          '',
          '## 项目概况',
          '- Vue 3',
          '[End PLAN]',
        ].join('\n'),
      },
    ]);
    expect(plan?.title).toBe('给 README 增加安装说明');
    expect(plan?.content).toContain('项目概况');
  });

  it('returns null when no plan tools exist', () => {
    expect(
      recoverPlanFromMessages([
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' },
      ])
    ).toBeNull();
  });
});
