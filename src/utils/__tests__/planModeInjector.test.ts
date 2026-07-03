import { describe, it, expect } from 'vitest';
import {
  PLAN_MODE_TEXT,
  formatPlanModeContext,
  prependPlanModeToUserMessage,
  prependPlanModeToLastUserMessage,
  stripPlanModeFromUserText,
} from '../planModeInjector';

describe('planModeInjector', () => {
  it('prepends plan mode block to user content', () => {
    const got = prependPlanModeToUserMessage('inspect repo');
    expect(got).toContain(PLAN_MODE_TEXT);
    expect(got).toContain('inspect repo');
  });

  it('is idempotent when plan block already present', () => {
    const once = prependPlanModeToUserMessage('inspect repo');
    const twice = prependPlanModeToUserMessage(once);
    expect(twice).toBe(once);
  });

  it('prepends only the last user message in a request list', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ];
    prependPlanModeToLastUserMessage(messages);
    expect(messages[0].content).toBe('first');
    expect(messages[2].content).toContain(PLAN_MODE_TEXT);
    expect(messages[2].content).toContain('second');
  });

  it('strips plan mode block for display', () => {
    const wrapped = prependPlanModeToUserMessage('inspect repo');
    expect(stripPlanModeFromUserText(wrapped)).toBe('inspect repo');
  });

  it('formats a stable tagged block', () => {
    expect(formatPlanModeContext()).toContain('[Plan Mode]');
    expect(formatPlanModeContext()).toContain('[End Plan Mode]');
  });
});
