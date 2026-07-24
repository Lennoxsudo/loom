import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUsageStore } from './useUsageStore';
import { useSettingsStore } from './useSettingsStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: vi.fn(() => false),
}));

describe('useUsageStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enableUsageTracking: true });
    useUsageStore.setState({
      total: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
      sessions: {},
      byModel: {},
    });
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

  it('stores and applies session titles', () => {
    const store = useUsageStore.getState();
    store.addUsage({
      sessionKey: 'conv-1',
      sessionTitle: 'Hello world',
      provider: 'openai',
      model: 'gpt-4o',
      input: 10,
      output: 5,
    });
    expect(useUsageStore.getState().sessions['conv-1'].title).toBe('Hello world');

    store.applySessionTitles({ 'conv-1': 'Renamed thread' });
    expect(useUsageStore.getState().sessions['conv-1'].title).toBe('Renamed thread');
  });
});
