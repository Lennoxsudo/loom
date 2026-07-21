import type { AIProvider } from './agentPersistence';
import { parseProviderAndModel } from './parseProviderAndModel';

export interface ProviderProfileRuntime {
  profileId: string;
  models: string[];
  defaultModel: string;
}

export interface LoadedAiConfig {
  selectedProvider?: string;
  configs?: Record<string, { models?: string[]; model?: string }>;
  profiles?: Record<
    string,
    {
      activeId?: string;
      items?: Array<{ id: string; name?: string; models?: string[] }>;
    }
  >;
  autoRouting?: {
    enabled?: boolean;
    entries?: Array<{
      provider: AIProvider;
      profileId: string;
      model: string;
    }>;
  };
}

export function getActiveProfileRuntime(
  config: LoadedAiConfig,
  provider: AIProvider
): ProviderProfileRuntime | null {
  const providerProfiles = config.profiles?.[provider];
  if (providerProfiles?.items?.length) {
    const activeId = providerProfiles.activeId || providerProfiles.items[0]?.id;
    const active =
      providerProfiles.items.find((item) => item.id === activeId) ?? providerProfiles.items[0];
    const models = (active.models ?? []).map((model) => model.trim()).filter(Boolean);
    if (models.length > 0 && active.id) {
      return { profileId: active.id, models, defaultModel: models[0] };
    }
  }

  const fallback = config.configs?.[provider];
  const models = fallback?.models?.length
    ? fallback.models
    : fallback?.model
      ? [fallback.model]
      : [];
  const filtered = models.map((model) => model.trim()).filter(Boolean);
  if (filtered.length === 0) {
    return null;
  }

  return { profileId: '', models: filtered, defaultModel: filtered[0] };
}

export function findProfileIdForModel(
  config: LoadedAiConfig,
  provider: AIProvider,
  model: string
): string | undefined {
  const trimmed = model.trim();
  if (!trimmed) {
    return undefined;
  }

  // Prefer the provider's active profile when it lists this model, so chat uses the
  // same endpoint as settings/tests instead of the first duplicate in the list.
  const active = getActiveProfileRuntime(config, provider);
  if (active?.profileId && active.models.includes(trimmed)) {
    return active.profileId;
  }

  const items = config.profiles?.[provider]?.items ?? [];
  for (const item of items) {
    if (item.models?.some((entry) => entry.trim() === trimmed)) {
      return item.id;
    }
  }
  return undefined;
}

export function getProfileRuntimeById(
  config: LoadedAiConfig,
  provider: AIProvider,
  profileId: string
): ProviderProfileRuntime | null {
  const profile = config.profiles?.[provider]?.items?.find((item) => item.id === profileId);
  if (!profile?.id) {
    return null;
  }
  const models = (profile.models ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (models.length === 0) {
    return null;
  }
  return { profileId: profile.id, models, defaultModel: models[0] };
}

export interface ModelSelection {
  model: string;
  profileId?: string;
  availableModels: string[];
}

export interface ProviderProfileOption {
  id: string;
  name: string;
  models: string[];
}

export function listProviderProfiles(
  config: LoadedAiConfig,
  provider: AIProvider
): ProviderProfileOption[] {
  const items = config.profiles?.[provider]?.items ?? [];
  if (items.length > 0) {
    return items.map((item) => ({
      id: item.id,
      name: item.name?.trim() || item.id,
      models: (item.models ?? []).map((entry) => entry.trim()).filter(Boolean),
    }));
  }

  const active = getActiveProfileRuntime(config, provider);
  if (!active) {
    return [];
  }

  return [
    {
      id: active.profileId,
      name: '',
      models: active.models,
    },
  ];
}

export function resolveExplicitProfileSelection(
  config: LoadedAiConfig,
  provider: AIProvider,
  profileId: string,
  preferredModel?: string,
  fallbackModel?: string
): ModelSelection {
  const profileRuntime = profileId
    ? getProfileRuntimeById(config, provider, profileId)
    : getActiveProfileRuntime(config, provider);

  const availableModels = profileRuntime?.models ?? [];
  const resolvedProfileId = profileRuntime?.profileId || profileId || undefined;
  const resolvedModel = pickModelFromAvailable(
    preferredModel,
    availableModels,
    fallbackModel
  );

  return {
    model: resolvedModel,
    profileId: resolvedProfileId,
    availableModels,
  };
}

export function resolveModelSelection(
  config: LoadedAiConfig,
  provider: AIProvider,
  model: string,
  profileId?: string,
  fallbackModel?: string
): ModelSelection {
  const reconciled = reconcileProviderRequest(config, provider, model, profileId);

  let availableModels: string[] = [];
  if (reconciled.profileId) {
    const profileRuntime = getProfileRuntimeById(config, provider, reconciled.profileId);
    if (profileRuntime) {
      availableModels = profileRuntime.models;
    }
  }
  if (availableModels.length === 0) {
    const active = getActiveProfileRuntime(config, provider);
    if (active) {
      availableModels = active.models;
    }
  }

  const resolvedModel = pickModelFromAvailable(
    reconciled.model,
    availableModels,
    fallbackModel
  );

  return {
    model: resolvedModel,
    profileId: reconciled.profileId,
    availableModels,
  };
}

export function reconcileProviderRequest(
  config: LoadedAiConfig,
  provider: AIProvider,
  model: string,
  profileId?: string
): { provider: AIProvider; model: string; profileId?: string } {
  const trimmedModel = model.trim();

  if (profileId) {
    const profile = config.profiles?.[provider]?.items?.find((item) => item.id === profileId);
    const profileModels = (profile?.models ?? []).map((entry) => entry.trim()).filter(Boolean);
    if (profileModels.length > 0) {
      if (trimmedModel && profileModels.includes(trimmedModel)) {
        return { provider, model: trimmedModel, profileId };
      }
      if (trimmedModel) {
        const owningProfileId = findProfileIdForModel(config, provider, trimmedModel);
        if (owningProfileId) {
          return { provider, model: trimmedModel, profileId: owningProfileId };
        }
      }
      return { provider, model: profileModels[0], profileId };
    }
  }

  if (trimmedModel) {
    const owningProfileId = findProfileIdForModel(config, provider, trimmedModel);
    if (owningProfileId) {
      return { provider, model: trimmedModel, profileId: owningProfileId };
    }
  }

  const active = getActiveProfileRuntime(config, provider);
  if (active) {
    const coerced =
      trimmedModel && active.models.includes(trimmedModel) ? trimmedModel : active.defaultModel;
    return {
      provider,
      model: coerced,
      profileId: active.profileId || undefined,
    };
  }

  return { provider, model: trimmedModel, profileId };
}

export function resolveComparableAgentModel(model: string | undefined | null): string {
  const trimmed = model?.trim() ?? '';
  if (!trimmed) return '';
  const parsed = parseProviderAndModel(trimmed);
  return parsed.model || trimmed;
}

export function agentModelSelectionsMatch(
  agentModel: string | undefined | null,
  selectedModel: string | undefined | null
): boolean {
  const agentComparable = resolveComparableAgentModel(agentModel);
  const selectedComparable = resolveComparableAgentModel(selectedModel);
  if (agentComparable && selectedComparable) {
    return agentComparable === selectedComparable;
  }
  return (agentModel?.trim() ?? '') === (selectedModel?.trim() ?? '');
}

export function pickModelFromAvailable(
  preferredModel: string | undefined,
  availableModels: string[],
  fallbackModel?: string
): string {
  const preferred = preferredModel?.trim();
  if (preferred && availableModels.includes(preferred)) {
    return preferred;
  }
  const fallback = resolveComparableAgentModel(fallbackModel);
  if (fallback && availableModels.includes(fallback)) {
    return fallback;
  }
  return availableModels[0] ?? '';
}

/** Resolve the first usable entry from the auto-routing chain. */
export function resolveAutoRoutingRequestRuntime(
  config: LoadedAiConfig
): { provider: AIProvider; model: string; profileId?: string } | null {
  const routing = config.autoRouting;
  if (!routing?.enabled) {
    return null;
  }

  const entry = routing.entries?.find(
    (item) => item.provider && item.profileId?.trim() && item.model?.trim()
  );
  if (!entry) {
    return null;
  }

  return reconcileProviderRequest(
    config,
    entry.provider,
    entry.model,
    entry.profileId
  );
}

export interface AutoRoutingResolveOptions {
  /**
   * When true, keep the active profile/model if it still matches a chain entry
   * (tool-round continuation after a successful switch within the same request).
   * When false (default), always start from chain entry #1 for a new user send.
   */
  reuseActiveEntry?: boolean;
}

/**
 * Resolve auto-routing runtime for a request.
 * Reuses the active profile/model only when `reuseActiveEntry` is true,
 * so tool rounds do not restart from entry #1 after a successful switch.
 */
export function resolveActiveAutoRoutingRuntime(
  config: LoadedAiConfig,
  active?: {
    provider?: string | null;
    profileId?: string | null;
    model?: string | null;
  },
  options?: AutoRoutingResolveOptions
): { provider: AIProvider; model: string; profileId?: string } | null {
  const routing = config.autoRouting;
  if (!routing?.enabled) {
    return null;
  }

  const profileId = active?.profileId?.trim();
  const model = active?.model?.trim();
  const provider = active?.provider?.trim();

  if (options?.reuseActiveEntry && profileId && model) {
    const matched = routing.entries?.find(
      (entry) =>
        entry.profileId === profileId &&
        entry.model === model &&
        (!provider || entry.provider === provider)
    );
    if (matched) {
      return reconcileProviderRequest(
        config,
        matched.provider,
        matched.model,
        matched.profileId
      );
    }
  }

  return resolveAutoRoutingRequestRuntime(config);
}
