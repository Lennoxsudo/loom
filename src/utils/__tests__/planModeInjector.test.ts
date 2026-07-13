import { describe, it, expect, beforeEach } from 'vitest';
import {
  PLAN_MODE_TEXT,
  PLAN_DOC_START_TAG,
  PLAN_DOC_END_TAG,
  formatPlanModeContext,
  formatPlanDocumentContext,
  prependPlanModeToUserMessage,
  prependPlanModeToLastUserMessage,
  prependPlanDocumentToUserMessage,
  injectPlanContextForRequest,
  stripPlanModeFromUserText,
} from '../planModeInjector';
import { clearPlan, setPlan } from '../../features/agent-engine/planStore';

describe('planModeInjector', () => {
  const conversationId = 'test-conv-plan';

  beforeEach(() => {
    clearPlan(conversationId);
  });

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

  it('formats structured PLAN document blocks', () => {
    const block = formatPlanDocumentContext({
      content: '1. Read files\n2. Implement feature',
      title: 'Feature X',
    });
    expect(block).toContain(PLAN_DOC_START_TAG);
    expect(block).toContain(PLAN_DOC_END_TAG);
    expect(block).toContain('# Feature X');
    expect(block).toContain('Implement feature');
  });

  it('prepends approved plan document for execution', () => {
    const got = prependPlanDocumentToUserMessage('go ahead', {
      content: 'Step 1: do the thing',
      title: 'Plan',
    });
    expect(got).toContain(PLAN_DOC_START_TAG);
    expect(got).toContain('Step 1: do the thing');
    expect(got).toContain('go ahead');
    expect(got).toContain('已批准计划');
  });

  it('injects plan mode + draft document while planning', () => {
    setPlan(conversationId, {
      content: 'Draft steps here',
      title: 'WIP',
      status: 'draft',
    });
    const messages = [{ role: 'user', content: 'build auth' }];
    injectPlanContextForRequest(messages, {
      interactionMode: 'plan',
      conversationId,
    });
    expect(messages[0].content).toContain(PLAN_MODE_TEXT);
    expect(messages[0].content).toContain(PLAN_DOC_START_TAG);
    expect(messages[0].content).toContain('Draft steps here');
  });

  it('injects accepted plan document in always-allow mode', () => {
    setPlan(conversationId, {
      content: 'Execute carefully',
      title: 'Final',
      status: 'accepted',
    });
    const messages = [{ role: 'user', content: 'continue' }];
    injectPlanContextForRequest(messages, {
      interactionMode: 'always-allow',
      conversationId,
    });
    expect(messages[0].content).toContain(PLAN_DOC_START_TAG);
    expect(messages[0].content).toContain('Execute carefully');
    expect(messages[0].content).not.toContain(PLAN_MODE_TEXT);
  });

  it('does not inject draft plan in always-allow mode', () => {
    setPlan(conversationId, {
      content: 'Still drafting',
      status: 'draft',
    });
    const messages = [{ role: 'user', content: 'continue' }];
    injectPlanContextForRequest(messages, {
      interactionMode: 'always-allow',
      conversationId,
    });
    expect(messages[0].content).toBe('continue');
  });
});
