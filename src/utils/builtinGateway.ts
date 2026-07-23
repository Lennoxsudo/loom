/**
 * Loom built-in models channel (Gateway-X via public HTTPS).
 * Endpoint is fixed; credentials come from invite activation only.
 */

export const BUILTIN_GATEWAY_BASE = 'https://gateway.tanyun.store/v1';
export const BUILTIN_GATEWAY_ORIGIN = 'https://gateway.tanyun.store';
export const BUILTIN_PROFILE_ID = 'builtin-gateway';
export const BUILTIN_PROFILE_NAME = 'Loom Built-in';
/** OpenAI-compatible provider id used for stream/chat (not a new Rust provider). */
export const BUILTIN_TRANSPORT_PROVIDER = 'openai' as const;

export const BUILTIN_STORAGE_FILE = 'builtin-gateway.json';

export type BuiltinProtocolId = 'builtin';

export interface BuiltinQuotas {
  qps: number;
  daily_requests: number;
  daily_tokens: number;
}

/** Live `GET /v1/quota` snapshot (limits + today usage + remaining). */
export interface BuiltinQuotaStatus {
  quotas: BuiltinQuotas;
  usage: {
    daily_requests: number;
    daily_tokens: number;
  };
  /** null = unlimited (gateway uses JSON null when limit is 0). */
  remaining: {
    daily_requests: number | null;
    daily_tokens: number | null;
  };
}

export interface BuiltinGatewayState {
  installId: string;
  apiKey: string | null;
  /** HMAC signing secret from activation; never written to openai profile. */
  clientSecret: string | null;
  clientId: string | null;
  activatedAt: string | null;
  lastQuotas: BuiltinQuotas | null;
}

export interface BuiltinActivateResponse {
  api_key: string;
  client_secret: string;
  endpoint?: string;
  client_id: string;
  quotas?: Partial<BuiltinQuotas> | null;
}

export function isBuiltinProtocol(
  protocol: string | null | undefined
): protocol is BuiltinProtocolId {
  return protocol === 'builtin';
}

/** Logical UI/persistence providers that stream via the OpenAI-compatible path. */
export function isOpenaiCompatibleLogicalProvider(provider: string | null | undefined): boolean {
  return provider === 'openai' || provider === 'builtin';
}

/**
 * Map a logical protocol (UI / conversation) to the Rust stream provider.
 * Built-in models use the existing openai transport + synthetic profile.
 */
export function toTransportProvider(
  provider: string | null | undefined
): 'openai' | 'anthropic' | 'ollama' {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'ollama') return 'ollama';
  // openai + builtin (+ unknown fallback)
  return 'openai';
}

/**
 * Profile id used when loading AI config / streaming for a logical provider.
 * Built-in always pins the injected openai profile.
 */
export function toTransportProfileId(
  provider: string | null | undefined,
  profileId?: string | null
): string | undefined {
  if (isBuiltinProtocol(provider)) {
    return BUILTIN_PROFILE_ID;
  }
  const trimmed = profileId?.trim();
  return trimmed || undefined;
}

/**
 * Provider key used when reading `profiles` / `configs` from load_ai_config.
 * Built-in models are stored under openai as profile `builtin-gateway`.
 */
export function toConfigProviderKey(
  provider: string | null | undefined
): 'openai' | 'anthropic' | 'ollama' {
  return toTransportProvider(provider);
}

export function buildTransportInvokeArgs(
  logicalProvider: string | null | undefined,
  model: string,
  profileId?: string | null
): {
  provider: 'openai' | 'anthropic' | 'ollama';
  model: string;
  profileId?: string;
} {
  return {
    provider: toTransportProvider(logicalProvider),
    model,
    profileId: toTransportProfileId(logicalProvider, profileId),
  };
}

export function keyPrefix(apiKey: string | null | undefined, keep = 12): string {
  if (!apiKey) return '';
  if (apiKey.length <= keep) return `${apiKey.slice(0, 4)}…`;
  return `${apiKey.slice(0, keep)}…`;
}

export function createInstallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeActivateResponse(raw: unknown): BuiltinActivateResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid activation response');
  }
  const obj = raw as Record<string, unknown>;
  const apiKey = typeof obj.api_key === 'string' ? obj.api_key : '';
  const clientSecret =
    typeof obj.client_secret === 'string'
      ? obj.client_secret
      : typeof obj.clientSecret === 'string'
        ? obj.clientSecret
        : '';
  const clientId = typeof obj.client_id === 'string' ? obj.client_id : '';
  if (!apiKey.trim() || !clientSecret.trim() || !clientId.trim()) {
    throw new Error('Activation response missing api_key, client_secret, or client_id');
  }
  let quotas: Partial<BuiltinQuotas> | null = null;
  if (obj.quotas && typeof obj.quotas === 'object') {
    const q = obj.quotas as Record<string, unknown>;
    quotas = {
      qps: typeof q.qps === 'number' ? q.qps : 0,
      daily_requests: typeof q.daily_requests === 'number' ? q.daily_requests : 0,
      daily_tokens: typeof q.daily_tokens === 'number' ? q.daily_tokens : 0,
    };
  }
  return {
    api_key: apiKey,
    client_secret: clientSecret,
    endpoint: typeof obj.endpoint === 'string' ? obj.endpoint : undefined,
    client_id: clientId,
    quotas,
  };
}

export function parseModelsListPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      const id = (item as { id: string }).id.trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

function readNonNegInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const n = Number(value);
    return n >= 0 ? Math.floor(n) : fallback;
  }
  return fallback;
}

/** Parse Gateway-X `GET /v1/quota` JSON. */
export function parseQuotaStatusPayload(payload: unknown): BuiltinQuotaStatus | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const quotasObj =
    obj.quotas && typeof obj.quotas === 'object' ? (obj.quotas as Record<string, unknown>) : null;
  const usageObj =
    obj.usage && typeof obj.usage === 'object' ? (obj.usage as Record<string, unknown>) : null;
  const remainingObj =
    obj.remaining && typeof obj.remaining === 'object'
      ? (obj.remaining as Record<string, unknown>)
      : null;
  if (!quotasObj || !usageObj || !remainingObj) return null;

  const remainingOf = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    return readNonNegInt(v, 0);
  };

  return {
    quotas: {
      qps: readNonNegInt(quotasObj.qps, 0),
      daily_requests: readNonNegInt(quotasObj.daily_requests, 0),
      daily_tokens: readNonNegInt(quotasObj.daily_tokens, 0),
    },
    usage: {
      daily_requests: readNonNegInt(usageObj.daily_requests, 0),
      daily_tokens: readNonNegInt(usageObj.daily_tokens, 0),
    },
    remaining: {
      daily_requests: remainingOf(remainingObj.daily_requests),
      daily_tokens: remainingOf(remainingObj.daily_tokens),
    },
  };
}

/** OpenAI-style gateway errors: `{ error: { message, type } }` or flat `{ message }` / `{ error: string }`. */
export function extractGatewayErrorMessage(payload: unknown, fallback = ''): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
  const err = obj.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const nested = err as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.trim()) {
      return nested.message.trim();
    }
  }
  return fallback;
}

/** Detect Gateway-X runtime auth failures in Rust/API error strings. */
export function isGatewayAuthErrorMessage(errorMsg: string): boolean {
  const text = errorMsg.trim();
  if (!text) return false;

  if (/client request signature|re-activate|重新激活|缺少 clientSecret|X-Gateway-/i.test(text)) {
    return true;
  }

  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as {
        error?: { type?: string; message?: string };
      };
      if (parsed.error?.type === 'auth_error') return true;
      const msg = parsed.error?.message ?? '';
      if (/unauthorized|re-activate|signature/i.test(msg)) return true;
    } catch {
      // not JSON — fall through
    }
  }

  return /\b401\b/.test(text) && /auth_error|unauthorized/i.test(text);
}

/** Map raw stream/API errors to a friendly built-in gateway message when appropriate. */
export function formatBuiltinGatewayStreamError(
  errorMsg: string,
  friendlyMessage: string,
  options?: { treatAsBuiltin?: boolean }
): string {
  const treatAsBuiltin = options?.treatAsBuiltin ?? false;
  if (treatAsBuiltin && /\b401\b/.test(errorMsg)) {
    return friendlyMessage;
  }
  if (isGatewayAuthErrorMessage(errorMsg)) {
    return friendlyMessage;
  }
  return errorMsg;
}

export function resolveBuiltinStreamError(
  errorMsg: string,
  friendlyMessage: string,
  options?: { treatAsBuiltin?: boolean }
): { message: string; unauthorized: boolean } {
  const message = formatBuiltinGatewayStreamError(errorMsg, friendlyMessage, options);
  return { message, unauthorized: message !== errorMsg };
}

export async function activateBuiltinGateway(
  inviteCode: string,
  installId: string,
  fetchImpl?: typeof fetch
): Promise<BuiltinActivateResponse> {
  const code = inviteCode.trim();
  if (!code) throw new Error('Invite code is required');
  if (!installId.trim()) throw new Error('install_id is required');

  // Prefer Tauri command (no CORS). Optional fetchImpl is for unit tests only.
  if (!fetchImpl) {
    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core');
      if (isTauri()) {
        const result = await invoke<Record<string, unknown>>('builtin_gateway_activate', {
          inviteCode: code,
          installId: installId.trim(),
        });
        return normalizeActivateResponse(result);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const err = new Error(msg) as Error & { status?: number };
      if (/401|unauthorized/i.test(msg)) err.status = 401;
      throw err;
    }
  }

  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(`${BUILTIN_GATEWAY_BASE}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ invite_code: code, install_id: installId }),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = extractGatewayErrorMessage(json) || text || `Activation failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return normalizeActivateResponse(json);
}

export async function fetchBuiltinModels(
  apiKey: string,
  fetchImpl?: typeof fetch
): Promise<string[]> {
  if (!fetchImpl) {
    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core');
      if (isTauri()) {
        const result = await invoke<{ models: string[] }>('builtin_gateway_list_models', {
          apiKey,
        });
        return Array.isArray(result?.models) ? result.models : [];
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const err = new Error(msg === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : msg) as Error & {
        status?: number;
      };
      if (msg === 'UNAUTHORIZED' || /401|unauthorized/i.test(msg)) err.status = 401;
      throw err;
    }
  }

  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(`${BUILTIN_GATEWAY_BASE}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 401) {
    const err = new Error('UNAUTHORIZED') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Failed to list models (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return parseModelsListPayload(json);
}

export async function checkBuiltinHealth(fetchImpl?: typeof fetch): Promise<boolean> {
  if (!fetchImpl) {
    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core');
      if (isTauri()) {
        const result = await invoke<{ ok: boolean }>('builtin_gateway_health');
        return Boolean(result?.ok);
      }
    } catch {
      return false;
    }
  }

  try {
    const doFetch = fetchImpl ?? fetch;
    const res = await doFetch(`${BUILTIN_GATEWAY_ORIGIN}/healthz`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchBuiltinQuota(
  apiKey: string,
  fetchImpl?: typeof fetch
): Promise<BuiltinQuotaStatus> {
  if (!fetchImpl) {
    try {
      const { invoke, isTauri } = await import('@tauri-apps/api/core');
      if (isTauri()) {
        const result = await invoke<Record<string, unknown>>('builtin_gateway_get_quota', {
          apiKey,
        });
        const parsed = parseQuotaStatusPayload(result);
        if (!parsed) throw new Error('Invalid quota response');
        return parsed;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const err = new Error(msg === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : msg) as Error & {
        status?: number;
      };
      if (msg === 'UNAUTHORIZED' || /401|unauthorized/i.test(msg)) err.status = 401;
      throw err;
    }
  }

  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(`${BUILTIN_GATEWAY_BASE}/quota`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 401) {
    const err = new Error('UNAUTHORIZED') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Failed to load quota (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const parsed = parseQuotaStatusPayload(json);
  if (!parsed) throw new Error('Invalid quota response');
  return parsed;
}

/** Shape used when merging into load_ai_config profiles.openai */
export function buildBuiltinProfileItem(apiKey: string, models: string[]) {
  return {
    id: BUILTIN_PROFILE_ID,
    name: BUILTIN_PROFILE_NAME,
    endpoint: BUILTIN_GATEWAY_BASE,
    apiKey,
    models: models.length > 0 ? models : [''],
    organizationId: undefined as string | undefined,
    supportsVision: false,
  };
}

/**
 * Ensure openai profiles contain the builtin gateway profile (in-memory + optional disk).
 * Does not remove user profiles. Marks activeId only when `makeActive` is true.
 */
export function mergeBuiltinProfileIntoAiConfig(
  config: Record<string, unknown>,
  apiKey: string,
  models: string[],
  options?: { makeActive?: boolean }
): Record<string, unknown> {
  const makeActive = options?.makeActive ?? false;
  const profiles = {
    ...((config.profiles as Record<string, unknown> | undefined) ?? {}),
  };
  const openai = {
    ...((profiles.openai as { activeId?: string; items?: unknown[] } | undefined) ?? {
      activeId: '',
      items: [],
    }),
  };
  const items = Array.isArray(openai.items) ? [...openai.items] : [];
  const item = buildBuiltinProfileItem(apiKey, models);
  const idx = items.findIndex(
    (it) => it && typeof it === 'object' && (it as { id?: string }).id === BUILTIN_PROFILE_ID
  );
  if (idx >= 0) {
    items[idx] = { ...(items[idx] as object), ...item };
  } else {
    items.push(item);
  }
  profiles.openai = {
    ...openai,
    items,
    activeId: makeActive
      ? BUILTIN_PROFILE_ID
      : openai.activeId || (items[0] as { id?: string })?.id,
  };
  const configs = {
    ...((config.configs as Record<string, unknown> | undefined) ?? {}),
  };
  // Keep configs.openai pointing at user active profile when not makeActive; when
  // makeActive, mirror builtin for legacy code paths that only read configs.
  if (makeActive) {
    configs.openai = {
      endpoint: BUILTIN_GATEWAY_BASE,
      apiKey,
      models: models.length > 0 ? models : [],
    };
  }
  return {
    ...config,
    profiles,
    configs,
  };
}
