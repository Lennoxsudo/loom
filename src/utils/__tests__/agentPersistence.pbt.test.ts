/**
 * Property-based tests for Agent persistence normalization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import type { Agent, AIProvider, AgentCapabilities } from '../agentPersistence';

const nonCliProviderArb: fc.Arbitrary<AIProvider> = fc.constantFrom(
  'openai' as const,
  'anthropic' as const,
  'gemini' as const,
  'ollama' as const,
);

const capabilitiesArb: fc.Arbitrary<AgentCapabilities> = fc.record({
  canExecuteCommands: fc.boolean(),
  canAccessBrowser: fc.boolean(),
  canUseGit: fc.boolean(),
  canUseMcp: fc.boolean(),
});

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-id',
    name: 'Test Agent',
    type: 'assistant',
    icon: '🤖',
    status: 'online',
    model: 'openai:gpt-4',
    temperature: 0.7,
    capabilities: {
      canExecuteCommands: false,
      canAccessBrowser: false,
      canUseGit: false,
      canUseMcp: false,
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const agentArb = (provider: fc.Arbitrary<AIProvider | undefined>): fc.Arbitrary<Agent> =>
  fc
    .record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      type: fc.constantFrom('assistant', 'coder', 'reviewer'),
      provider: provider,
      capabilities: capabilitiesArb,
    })
    .map(({ id, name, type, provider, capabilities }) =>
      makeAgent({ id, name, type, provider, capabilities }),
    );

describe('Agent persistence normalization', () => {
  let storedAgent: Agent | null;

  beforeEach(() => {
    vi.resetModules();
    storedAgent = null;

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_agent') {
        return storedAgent ? { ...storedAgent } : null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it('old provider agents retain all fields after normalizeAgent', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentArb(nonCliProviderArb),
        fc.string({ minLength: 0, maxLength: 100 }),
        async (agent, rules) => {
          storedAgent = { ...agent, rules };

          const { getAgent } = await import('../agentPersistence');
          const loaded = await getAgent();

          expect(loaded).toBeDefined();
          expect(loaded!.id).toBe(agent.id);
          expect(loaded!.name).toBe(agent.name);
          expect(loaded!.type).toBe(agent.type);
          expect(loaded!.model).toBe(agent.model);
          expect(loaded!.temperature).toBe(agent.temperature);
          expect(loaded!.capabilities).toEqual(agent.capabilities);
          expect(loaded!.createdAt).toBe(agent.createdAt);
          expect(loaded!.updatedAt).toBe(agent.updatedAt);
          expect(loaded!.provider).toBe(agent.provider);
          expect(loaded!.rules).toBe(rules);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('migrates legacy claude-cli provider to openai', async () => {
    storedAgent = makeAgent({
      id: 'legacy-cli',
      provider: 'claude-cli' as unknown as AIProvider,
      model: 'claude-sonnet-4-5',
    });

    const { getAgent } = await import('../agentPersistence');
    const loaded = await getAgent();
    expect(loaded?.provider).toBe('openai');
  });
});
