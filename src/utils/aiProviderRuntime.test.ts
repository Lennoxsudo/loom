import { describe, expect, it } from 'vitest';
import {
  agentModelSelectionsMatch,
  findProfileIdForModel,
  getActiveProfileRuntime,
  getProfileRuntimeById,
  listProviderProfiles,
  pickModelFromAvailable,
  reconcileProviderRequest,
  resolveActiveAutoRoutingRuntime,
  resolveAutoRoutingRequestRuntime,
  resolveComparableAgentModel,
  resolveExplicitProfileSelection,
  resolveModelSelection,
  type LoadedAiConfig,
} from './aiProviderRuntime';

const sampleConfig = {
  configs: {
    openai: {
      models: ['legacy-model'],
    },
  },
  profiles: {
    openai: {
      activeId: 'profile-a',
      items: [
        {
          id: 'profile-a',
          name: '默认配置',
          models: ['mimo-v2.5-pro', 'mimo-v2.5', 'shared-model'],
        },
        {
          id: 'profile-b',
          name: '英伟达',
          models: ['glm-4.7-flash', 'shared-model'],
        },
      ],
    },
  },
};

describe('getActiveProfileRuntime', () => {
  it('returns active profile models and id', () => {
    expect(getActiveProfileRuntime(sampleConfig, 'openai')).toEqual({
      profileId: 'profile-a',
      models: ['mimo-v2.5-pro', 'mimo-v2.5', 'shared-model'],
      defaultModel: 'mimo-v2.5-pro',
    });
  });
});

describe('findProfileIdForModel', () => {
  it('finds the profile that owns a model', () => {
    expect(findProfileIdForModel(sampleConfig, 'openai', 'glm-4.7-flash')).toBe('profile-b');
  });

  it('prefers active profile when the same model exists on multiple profiles', () => {
    const duplicateModelConfig: LoadedAiConfig = {
      profiles: {
        openai: {
          activeId: 'profile-gateway',
          items: [
            {
              id: 'profile-direct',
              name: '直连',
              models: ['shared-model', 'only-direct'],
            },
            {
              id: 'profile-gateway',
              name: 'Gateway',
              models: ['shared-model', 'gateway-only'],
            },
          ],
        },
      },
    };

    expect(findProfileIdForModel(duplicateModelConfig, 'openai', 'shared-model')).toBe(
      'profile-gateway'
    );
    expect(findProfileIdForModel(duplicateModelConfig, 'openai', 'only-direct')).toBe(
      'profile-direct'
    );
  });
});

describe('pickModelFromAvailable', () => {
  it('prefers a valid current model', () => {
    expect(pickModelFromAvailable('mimo-v2.5', ['mimo-v2.5-pro', 'mimo-v2.5'], 'gpt-4o')).toBe(
      'mimo-v2.5'
    );
  });

  it('falls back when the current model is unavailable', () => {
    expect(pickModelFromAvailable('gpt-4o', ['mimo-v2.5-pro', 'mimo-v2.5'], 'gpt-4o')).toBe(
      'mimo-v2.5-pro'
    );
  });

  it('parses composite fallback model ids before matching available models', () => {
    expect(
      pickModelFromAvailable('', ['mimo-v2.5-pro', 'mimo-v2.5'], 'openai:profile-a:mimo-v2.5:0')
    ).toBe('mimo-v2.5');
  });
});

describe('agentModelSelectionsMatch', () => {
  it('treats composite agent ids and plain UI ids as the same model', () => {
    expect(agentModelSelectionsMatch('openai:profile-a:mimo-v2.5:0', 'mimo-v2.5')).toBe(true);
    expect(resolveComparableAgentModel('openai:profile-a:mimo-v2.5:0')).toBe('mimo-v2.5');
  });
});

describe('getProfileRuntimeById', () => {
  it('returns models for a specific profile', () => {
    expect(getProfileRuntimeById(sampleConfig, 'openai', 'profile-b')).toEqual({
      profileId: 'profile-b',
      models: ['glm-4.7-flash', 'shared-model'],
      defaultModel: 'glm-4.7-flash',
    });
  });
});

describe('listProviderProfiles', () => {
  it('returns named profile options for a provider', () => {
    expect(listProviderProfiles(sampleConfig, 'openai')).toEqual([
      {
        id: 'profile-a',
        name: '默认配置',
        models: ['mimo-v2.5-pro', 'mimo-v2.5', 'shared-model'],
      },
      {
        id: 'profile-b',
        name: '英伟达',
        models: ['glm-4.7-flash', 'shared-model'],
      },
    ]);
  });

  it('falls back to legacy configs when profiles are missing', () => {
    expect(listProviderProfiles({ configs: sampleConfig.configs }, 'openai')).toEqual([
      {
        id: '',
        name: '',
        models: ['legacy-model'],
      },
    ]);
  });
});

describe('resolveExplicitProfileSelection', () => {
  it('keeps the selected profile even when the model exists in another profile', () => {
    expect(
      resolveExplicitProfileSelection(sampleConfig, 'openai', 'profile-a', 'shared-model')
    ).toEqual({
      model: 'shared-model',
      profileId: 'profile-a',
      availableModels: ['mimo-v2.5-pro', 'mimo-v2.5', 'shared-model'],
    });
  });

  it('does not jump to another profile via model ownership', () => {
    const inferred = resolveModelSelection(sampleConfig, 'openai', 'glm-4.7-flash', 'profile-a');
    const explicit = resolveExplicitProfileSelection(
      sampleConfig,
      'openai',
      'profile-a',
      'glm-4.7-flash'
    );

    expect(inferred.profileId).toBe('profile-b');
    expect(explicit).toEqual({
      model: 'mimo-v2.5-pro',
      profileId: 'profile-a',
      availableModels: ['mimo-v2.5-pro', 'mimo-v2.5', 'shared-model'],
    });
  });
});

describe('resolveModelSelection', () => {
  it('binds model to owning profile and exposes that profile models', () => {
    expect(resolveModelSelection(sampleConfig, 'openai', 'glm-4.7-flash', 'profile-a')).toEqual({
      model: 'glm-4.7-flash',
      profileId: 'profile-b',
      availableModels: ['glm-4.7-flash', 'shared-model'],
    });
  });

  it('falls back to active profile when model is unknown', () => {
    expect(resolveModelSelection(sampleConfig, 'openai', 'gpt-4o', 'profile-a')).toEqual({
      model: 'mimo-v2.5-pro',
      profileId: 'profile-a',
      availableModels: ['mimo-v2.5-pro', 'mimo-v2.5', 'shared-model'],
    });
  });
});

const autoRoutingConfig: LoadedAiConfig = {
  ...sampleConfig,
  autoRouting: {
    enabled: true,
    entries: [
      { provider: 'openai', profileId: 'profile-a', model: 'mimo-v2.5-pro' },
      { provider: 'openai', profileId: 'profile-a', model: 'mimo-v2.5' },
      { provider: 'openai', profileId: 'profile-a', model: 'shared-model' },
      { provider: 'openai', profileId: 'profile-b', model: 'glm-4.7-flash' },
    ],
  },
};

describe('resolveAutoRoutingRequestRuntime', () => {
  it('starts from the first chain entry', () => {
    expect(resolveAutoRoutingRequestRuntime(autoRoutingConfig)).toEqual({
      provider: 'openai',
      model: 'mimo-v2.5-pro',
      profileId: 'profile-a',
    });
  });

  it('defaults to chain head on a new send even when active runtime matches a later entry', () => {
    const active = {
      provider: 'openai',
      profileId: 'profile-b',
      model: 'glm-4.7-flash',
    };
    expect(resolveActiveAutoRoutingRuntime(autoRoutingConfig, active)).toEqual({
      provider: 'openai',
      model: 'mimo-v2.5-pro',
      profileId: 'profile-a',
    });
  });

  it('reuses active entry during tool-round continuation when reuseActiveEntry is true', () => {
    const active = {
      provider: 'openai',
      profileId: 'profile-b',
      model: 'glm-4.7-flash',
    };
    expect(
      resolveActiveAutoRoutingRuntime(autoRoutingConfig, active, { reuseActiveEntry: true })
    ).toEqual({
      provider: 'openai',
      model: 'glm-4.7-flash',
      profileId: 'profile-b',
    });
  });
});

describe('reconcileProviderRequest', () => {
  it('coerces stale models to the active profile default', () => {
    expect(reconcileProviderRequest(sampleConfig, 'openai', 'gpt-4o')).toEqual({
      provider: 'openai',
      model: 'mimo-v2.5-pro',
      profileId: 'profile-a',
    });
  });

  it('routes models to the profile that owns them', () => {
    expect(reconcileProviderRequest(sampleConfig, 'openai', 'glm-4.7-flash')).toEqual({
      provider: 'openai',
      model: 'glm-4.7-flash',
      profileId: 'profile-b',
    });
  });

  it('prefers active profile for duplicate models when profileId is omitted', () => {
    const duplicateModelConfig: LoadedAiConfig = {
      profiles: {
        openai: {
          activeId: 'profile-gateway',
          items: [
            {
              id: 'profile-direct',
              models: ['sensenova-6.7-flash-lite'],
            },
            {
              id: 'profile-gateway',
              models: ['sensenova-6.7-flash-lite'],
            },
          ],
        },
      },
    };

    expect(
      reconcileProviderRequest(duplicateModelConfig, 'openai', 'sensenova-6.7-flash-lite')
    ).toEqual({
      provider: 'openai',
      model: 'sensenova-6.7-flash-lite',
      profileId: 'profile-gateway',
    });
  });

  it('prefers owning profile over stale profileId', () => {
    expect(reconcileProviderRequest(sampleConfig, 'openai', 'glm-4.7-flash', 'profile-a')).toEqual({
      provider: 'openai',
      model: 'glm-4.7-flash',
      profileId: 'profile-b',
    });
  });
});
