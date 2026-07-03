import { describe, expect, it } from 'vitest';
import type { Agent } from '../agentPersistence';
import {
  reconcileAgentRequestRuntime,
  resolveAgentRequestRuntime,
} from '../../components/agent/utils';

const sampleConfig = {
  profiles: {
    openai: {
      activeId: 'profile-a',
      items: [
        { id: 'profile-a', models: ['mimo-v2.5-pro', 'mimo-v2.5'] },
        { id: 'profile-b', models: ['glm-4.7-flash'] },
      ],
    },
  },
};

function createTestAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Agent',
    type: 'assistant',
    icon: '🤖',
    status: 'online',
    description: '',
    model: 'mimo-v2.5-pro',
    provider: 'openai',
    profileId: 'profile-a',
    temperature: 0.2,
    capabilities: {
      canExecuteCommands: true,
      canAccessBrowser: true,
      canUseGit: true,
      canUseMcp: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('reconcileAgentRequestRuntime', () => {
  it('keeps UI runtime aligned when model belongs to a different profile', () => {
    const agent = createTestAgent();
    const uiRuntime = {
      provider: 'openai' as const,
      model: 'glm-4.7-flash',
      profileId: 'profile-a',
    };

    const resolved = resolveAgentRequestRuntime(agent, uiRuntime);
    expect(resolved.model).toBe('glm-4.7-flash');

    const reconciled = reconcileAgentRequestRuntime(sampleConfig, agent, uiRuntime);
    expect(reconciled).toEqual({
      provider: 'openai',
      model: 'glm-4.7-flash',
      profileId: 'profile-b',
    });
  });

  it('matches resolve and reconcile when profileId is in sync', () => {
    const agent = createTestAgent({ model: 'mimo-v2.5' });
    const uiRuntime = {
      provider: 'openai' as const,
      model: 'mimo-v2.5',
      profileId: 'profile-a',
    };

    const reconciled = reconcileAgentRequestRuntime(sampleConfig, agent, uiRuntime);
    expect(reconciled).toEqual({
      provider: 'openai',
      model: 'mimo-v2.5',
      profileId: 'profile-a',
    });
  });
});
