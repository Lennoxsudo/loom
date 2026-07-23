import { describe, it, expect, beforeEach } from 'vitest';
import { useUsageStore } from './useUsageStore';
import { useSettingsStore } from './useSettingsStore';

describe('useUsageStore', () => {
  beforeEach(() => {
    useUsageStore.getState().reset();
  });

  it('accumulates totals across addUsage calls', () => {
    const store = useUsageStore.getState();
    store.addUsage({
      sessionKey: 's1',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      input: 1000,
      output: 500,
    });
    store.addUsage({
      sessionKey: 's1',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      input: 1000,
      output: 500,
    });
    const { total } = useUsageStore.getState();
    expect(total.inputTokens).toBe(2000);
    expect(total.outputTokens).toBe(1000);
    expect(total.costUsd).toBeGreaterThan(0);
  });

  it('tracks per-session and per-model breakdown', () => {
    const store = useUsageStore.getState();
    store.addUsage({
      sessionKey: 'a',
      provider: 'openai',
      model: 'gpt-4o',
      input: 100,
      output: 100,
    });
    store.addUsage({
      sessionKey: 'b',
      provider: 'openai',
      model: 'gpt-4o',
      input: 200,
      output: 200,
    });
    const state = useUsageStore.getState();
    expect(state.sessions['a'].inputTokens).toBe(100);
    expect(state.sessions['b'].inputTokens).toBe(200);
    expect(state.byModel['openai:gpt-4o'].inputTokens).toBe(300);
  });

  it('reset clears all counters', () => {
    const store = useUsageStore.getState();
    store.addUsage({ provider: 'anthropic', model: 'claude-3-5-sonnet', input: 1000, output: 500 });
    store.reset();
    const { total } = useUsageStore.getState();
    expect(total.inputTokens).toBe(0);
    expect(total.outputTokens).toBe(0);
    expect(total.costUsd).toBe(0);
  });

  it('does not accumulate when usage tracking is disabled', () => {
    useSettingsStore.setState({ enableUsageTracking: false });
    try {
      useUsageStore.getState().addUsage({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        input: 1000,
        output: 500,
      });
      const { total } = useUsageStore.getState();
      expect(total.inputTokens).toBe(0);
      expect(total.outputTokens).toBe(0);
    } finally {
      useSettingsStore.setState({ enableUsageTracking: true });
    }
  });
});
