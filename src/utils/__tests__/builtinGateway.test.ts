import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_GATEWAY_BASE,
  BUILTIN_PROFILE_ID,
  activateBuiltinGateway,
  buildTransportInvokeArgs,
  buildBuiltinProfileItem,
  fetchBuiltinQuota,
  isBuiltinProtocol,
  isOpenaiCompatibleLogicalProvider,
  keyPrefix,
  formatBuiltinGatewayStreamError,
  isGatewayAuthErrorMessage,
  mergeBuiltinProfileIntoAiConfig,
  normalizeActivateResponse,
  parseModelsListPayload,
  parseQuotaStatusPayload,
  toConfigProviderKey,
  toTransportProfileId,
  toTransportProvider,
} from '../builtinGateway';

describe('builtinGateway helpers', () => {
  it('detects builtin protocol', () => {
    expect(isBuiltinProtocol('builtin')).toBe(true);
    expect(isBuiltinProtocol('openai')).toBe(false);
    expect(isBuiltinProtocol('auto')).toBe(false);
  });

  it('maps builtin to openai transport + fixed profile', () => {
    expect(toTransportProvider('builtin')).toBe('openai');
    expect(toTransportProvider('openai')).toBe('openai');
    expect(toTransportProvider('anthropic')).toBe('anthropic');
    expect(toConfigProviderKey('builtin')).toBe('openai');
    expect(toTransportProfileId('builtin', 'anything')).toBe(BUILTIN_PROFILE_ID);
    expect(toTransportProfileId('openai', 'p1')).toBe('p1');
    expect(isOpenaiCompatibleLogicalProvider('builtin')).toBe(true);
    expect(buildTransportInvokeArgs('builtin', 'gpt-x', 'ignored')).toEqual({
      provider: 'openai',
      model: 'gpt-x',
      profileId: BUILTIN_PROFILE_ID,
    });
  });

  it('prefixes api keys', () => {
    expect(keyPrefix('sk-gw-rt-abcdefghijklmnop')).toBe('sk-gw-rt-abc…');
    expect(keyPrefix('sk-gw-rt-abcdefghijklmnop', 16)).toMatch(/^sk-gw-rt-abcdef/);
    expect(keyPrefix(null)).toBe('');
  });

  it('parses models list', () => {
    expect(
      parseModelsListPayload({
        data: [{ id: 'a' }, { id: 'b' }, { id: 1 }, null],
      })
    ).toEqual(['a', 'b']);
  });

  it('normalizes activate response', () => {
    const r = normalizeActivateResponse({
      api_key: 'sk-1',
      client_secret: 'gwsec_1',
      client_id: 'rt_1',
      quotas: { qps: 5, daily_requests: 100, daily_tokens: 0 },
    });
    expect(r.api_key).toBe('sk-1');
    expect(r.client_secret).toBe('gwsec_1');
    expect(r.client_id).toBe('rt_1');
    expect(r.quotas?.qps).toBe(5);
  });

  it('rejects activate response without client_secret', () => {
    expect(() =>
      normalizeActivateResponse({
        api_key: 'sk-1',
        client_id: 'rt_1',
      })
    ).toThrow(/client_secret/);
  });

  it('activate posts invite + install_id', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          api_key: 'sk-x',
          client_secret: 'gwsec_x',
          client_id: 'rt_x',
          quotas: { qps: 1 },
        }),
    }));
    const result = await activateBuiltinGateway(
      'CODE',
      'install-1',
      fetchImpl as unknown as typeof fetch
    );
    expect(result.api_key).toBe('sk-x');
    expect(result.client_secret).toBe('gwsec_x');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BUILTIN_GATEWAY_BASE}/activate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ invite_code: 'CODE', install_id: 'install-1' }),
      })
    );
  });

  it('activate surfaces http errors', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'code exhausted' }),
    }));
    await expect(
      activateBuiltinGateway('CODE', 'install-1', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/code exhausted/);
  });

  it('activate surfaces nested error.message (gateway auth_error shape)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error' } }),
    }));
    await expect(
      activateBuiltinGateway('CODE', 'install-1', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ message: 'Unauthorized', status: 401 });
  });

  it('parseQuotaStatusPayload reads limits / usage / remaining', () => {
    const status = parseQuotaStatusPayload({
      quotas: { qps: 5, daily_requests: 500, daily_tokens: 0 },
      usage: { daily_requests: 12, daily_tokens: 0 },
      remaining: { daily_requests: 488, daily_tokens: null },
    });
    expect(status).toEqual({
      quotas: { qps: 5, daily_requests: 500, daily_tokens: 0 },
      usage: { daily_requests: 12, daily_tokens: 0 },
      remaining: { daily_requests: 488, daily_tokens: null },
    });
  });

  it('fetchBuiltinQuota calls GET /quota with bearer', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        quotas: { qps: 5, daily_requests: 500, daily_tokens: 0 },
        usage: { daily_requests: 3, daily_tokens: 0 },
        remaining: { daily_requests: 497, daily_tokens: null },
      }),
    }));
    const result = await fetchBuiltinQuota('sk-test', fetchImpl as unknown as typeof fetch);
    expect(result.usage.daily_requests).toBe(3);
    expect(result.remaining.daily_requests).toBe(497);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BUILTIN_GATEWAY_BASE}/quota`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      })
    );
  });

  it('buildBuiltinProfileItem does not expose clientSecret', () => {
    const item = buildBuiltinProfileItem('sk-gw', ['model-a']);
    expect(item.apiKey).toBe('sk-gw');
    expect(item).not.toHaveProperty('clientSecret');
  });

  it('detects gateway auth_error in stream API error strings', () => {
    const raw = 'API返回错误 401: {"error":{"message":"Unauthorized","type":"auth_error"}}';
    expect(isGatewayAuthErrorMessage(raw)).toBe(true);
    expect(
      formatBuiltinGatewayStreamError(raw, '请重新激活内置模型', { treatAsBuiltin: true })
    ).toBe('请重新激活内置模型');
  });

  it('merges builtin profile into ai config without clobbering other items', () => {
    const merged = mergeBuiltinProfileIntoAiConfig(
      {
        profiles: {
          openai: {
            activeId: 'user-1',
            items: [
              { id: 'user-1', name: 'Mine', endpoint: 'http://x', apiKey: 'k', models: ['m'] },
            ],
          },
        },
      },
      'sk-gw',
      ['model-a', 'model-b']
    );
    const openai = (
      merged.profiles as { openai: { activeId: string; items: Array<{ id: string }> } }
    ).openai;
    expect(openai.activeId).toBe('user-1');
    expect(openai.items.some((i) => i.id === 'user-1')).toBe(true);
    expect(openai.items.some((i) => i.id === BUILTIN_PROFILE_ID)).toBe(true);
  });
});
