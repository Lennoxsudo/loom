/**
 * Property-based tests for agentPersistence
 *
 * Feature: agent-rules, Property 2: Agent Rules 持久化往返一致性
 * Validates: Requirements 6.1, 6.2, 6.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import type { Agent, CreateAgentPayload, AgentCapabilities, AIProvider } from '../agentPersistence';

const capabilitiesArb: fc.Arbitrary<AgentCapabilities> = fc.record({
  canExecuteCommands: fc.boolean(),
  canAccessBrowser: fc.boolean(),
  canUseGit: fc.boolean(),
  canUseMcp: fc.boolean(),
});

const rulesArb = fc.oneof(
  fc.constant(''),
  fc.constant(undefined),
  fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 }).map((arr) => arr.join('')),
  fc.string({ minLength: 1, maxLength: 200 }),
);

const createAgentPayloadArb: fc.Arbitrary<CreateAgentPayload> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  type: fc.constantFrom('assistant', 'coder', 'reviewer'),
  icon: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  model: fc.constantFrom('openai:gpt-4', 'anthropic:claude-3', 'gemini:pro'),
  provider: fc.option(fc.constantFrom('openai', 'anthropic', 'gemini', 'ollama') as fc.Arbitrary<AIProvider>, { nil: undefined }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
  capabilities: capabilitiesArb,
  callable: fc.option(fc.boolean(), { nil: undefined }),
  callableDescription: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  rules: rulesArb,
});

describe('Feature: agent-rules, Property 2: Agent Rules 持久化往返一致性', () => {
  let storedAgent: Agent | null;

  beforeEach(() => {
    vi.resetModules();
    storedAgent = null;

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const params = args as Record<string, unknown> | undefined;
      if (cmd === 'save_agent') {
        const { agent } = params as { agent: Agent };
        storedAgent = { ...agent, updatedAt: new Date().toISOString() };
        return storedAgent;
      }
      if (cmd === 'get_agent') {
        return storedAgent ? { ...storedAgent } : null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it('create then load should preserve the rules field', async () => {
    await fc.assert(
      fc.asyncProperty(createAgentPayloadArb, async (payload) => {
        storedAgent = null;

        const { createDefaultAgent, getAgent } = await import('../agentPersistence');

        const created = await createDefaultAgent(payload);
        const loaded = await getAgent();

        expect(loaded).toBeDefined();
        expect(loaded!.id).toBe(created.id);

        const expectedRules = payload.rules ?? '';
        expect(loaded!.rules).toBe(expectedRules);
      }),
      { numRuns: 100 },
    );
  });

  it('loading agent without rules field should default to empty string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (agentName) => {
          storedAgent = null;

          const oldAgent = {
            id: 'old-agent-1',
            name: agentName,
            type: 'assistant',
            icon: '🤖',
            status: 'online' as const,
            model: 'openai:gpt-4',
            temperature: 0.7,
            capabilities: {
              canExecuteCommands: false,
              canAccessBrowser: true,
              canUseGit: true,
              canUseMcp: true,
            },
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          };

          storedAgent = oldAgent as Agent;

          const { getAgent } = await import('../agentPersistence');
          const loaded = await getAgent();

          expect(loaded).toBeDefined();
          expect(loaded!.rules).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});
