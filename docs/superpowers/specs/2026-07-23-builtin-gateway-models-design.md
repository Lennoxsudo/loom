# Built-in Models via Gateway-X (Design)

**Date:** 2026-07-23  
**Status:** Approved for implementation planning  
**Repos:** Loom (`Aiasprrato`) + Gateway-X (`D:\project\Gateway-X`)  
**Remote edge:** Cloudflare Tunnel `D:\cloudflared` → `https://gateway.tanyun.store`

## Goal

Ship **built-in models** in Loom that require **no per-upstream configuration**. Users redeem an **invite code** to receive a **dedicated Gateway-X client key**, then chat/agent traffic uses a first-class **`builtin` protocol** against a fixed public OpenAI-compatible endpoint.

Upstream API keys never enter Loom. The installer never embeds a long-lived client secret.

## Non-goals (v1)

- Full user accounts / OAuth / billing UI  
- Editing the built-in endpoint inside Loom  
- Writing activation data into Gateway-X `config.yaml`  
- Built-in model allowlists or “recommended” grouping in Loom  
- Putting `builtin` into the auto-routing fallback chain by default  
- OS credential-manager encryption beyond existing app data practices (optional later)

## Product decisions (locked)

| Topic | Decision |
|-------|----------|
| Hosting | Remote Gateway-X exposed via cloudflared |
| Public API base | **Fixed** `https://gateway.tanyun.store/v1` |
| Auth model | Invite-code activation → per-client API key |
| Issuance | Inside Gateway-X (`POST /v1/activate`) |
| Persistence | `data/invite_codes.json` + `data/clients.runtime.json` only |
| Invite rules | Per-code: max redemptions, expiry, disabled; default template one-time |
| Loom UI | Settings section for activate/clear; Chat/Agent **`builtin`** protocol |
| Models | Full `GET /v1/models` union from gateway |
| Key lifecycle | Long-lived on device; local clear; Admin revoke; 401 → re-activate |
| Quotas | Global defaults + per-invite `quota_template` |
| Re-activate | Same `install_id` rebinds / rotates key; **daily quota counters not reset** |

## Architecture

```text
Loom (builtin protocol)
  │  Bearer client key
  │  POST/GET https://gateway.tanyun.store/v1/*
  ▼
cloudflared (D:\cloudflared\config.yml)
  hostname: gateway.tanyun.store → http://127.0.0.1:8787
  ▼
Gateway-X
  auth: config.yaml clients ∪ data/clients.runtime.json
  activate: POST /v1/activate → invite_codes + clients.runtime
  proxy: existing auto routing / model_mappings / upstreams
```

**Secret layers**

1. Upstream keys → only Gateway-X `config.yaml`  
2. Public hostname → safe to hardcode in Loom  
3. Client keys → issued at activate time; stored only on user machine + gateway runtime file  
4. Invite codes → gateway data file; rate-limited redemption  

## Gateway-X design

### Effective clients

```text
effective_clients = yaml.clients ∪ runtime.clients (where disabled != true)
```

Chat, models list, quotas, and metrics use the merged set. **No writes to `config.yaml` from activation.**

### `data/invite_codes.json`

```json
{
  "version": 1,
  "codes": [
    {
      "code": "LOOM-XXXX-XXXX",
      "max_redemptions": 1,
      "redeemed_count": 0,
      "expires_at": null,
      "disabled": false,
      "quota_template": {
        "qps": 5,
        "daily_requests": 500,
        "daily_tokens": 0
      },
      "note": "",
      "created_at": "2026-07-23T00:00:00Z"
    }
  ]
}
```

- `max_redemptions`: `1` = one install; `N` = N distinct first-time installs; document whether `0` means unlimited (if supported, pair with tight defaults).  
- **`redeemed_count` increments only on first bind of a new `install_id`**, not on rebind.  
- Missing `quota_template` → server global defaults.

### `data/clients.runtime.json`

```json
{
  "version": 1,
  "clients": [
    {
      "id": "rt_…",
      "name": "loom-activate",
      "api_key": "sk-gw-rt-…",
      "install_id": "uuid",
      "invite_code": "LOOM-…",
      "qps": 5,
      "daily_requests": 500,
      "daily_tokens": 0,
      "allowed_models": [],
      "disabled": false,
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

**v1 storage:** plaintext `api_key` aligned with existing yaml clients (file permissions / host security). Optional later: store hash only and return plaintext once at issue time.

**Quota counter identity:** stable `client.id` (not the key string). Key rotation must not reset daily usage for that id.

**Revoke:** set `disabled: true` in Admin; auth rejects immediately.

**Persistence:** atomic write (temp file + rename). Load on startup; optional hot-reload with admin mutations.

### `POST /v1/activate`

- **Auth:** none (public).  
- **Rate limit:** per IP and per invite_code on failures (e.g. 10/min).  
- **Body:**

```json
{ "invite_code": "LOOM-XXXX", "install_id": "uuid-v4" }
```

**Algorithm**

1. Validate non-empty `invite_code` and `install_id`.  
2. Load invite; reject if missing, `disabled`, expired, or (for new install) `redeemed_count >= max_redemptions`.  
3. If runtime client exists for `(invite_code, install_id)` (or policy: same `install_id` under that code):  
   - **Rebind:** rotate `api_key`, update `updated_at`; do **not** increment `redeemed_count`; do **not** reset quota counters; return new key.  
4. Else **first bind:** create runtime client from template/defaults; `redeemed_count++`; persist both files; return key.  
5. Reject key collisions with yaml or other runtime clients.

**Success 200**

```json
{
  "api_key": "sk-gw-rt-…",
  "endpoint": "https://gateway.tanyun.store/v1",
  "client_id": "rt_…",
  "quotas": { "qps": 5, "daily_requests": 500, "daily_tokens": 0 }
}
```

**Errors:** 400 invalid body; 403 bad/disabled/expired/exhausted code; 429 rate limit.

### Admin

- CRUD-ish invite codes: create, list, disable, set max/expiry/template.  
- List runtime clients; disable (revoke).  
- Do not require editing yaml for activated users.  
- Optional later: edit runtime quotas without revoke.

### Unchanged gateway behavior

- `POST /v1/chat/completions`, `GET /v1/models`, auto routing, model_mappings, failover, circuit breaker.  
- cloudflared ingress and `trusted_proxies` as already documented for tunnel.

### Default quotas (suggested)

| Field | Default |
|-------|---------|
| qps | 5 |
| daily_requests | 500 |
| daily_tokens | 0 (unlimited) |

Invite `quota_template` overrides per issuance.

## Loom design

### Settings: Built-in / Gateway section

- Status: inactive / active / error (incl. needs re-activate).  
- Invite code field + Activate.  
- When active: client id / key prefix / last known quotas; **never** show full key in normal UI.  
- Clear local key (deletes `apiKey` only).  
- Re-activate with same code (rebind).  
- Optional health: `GET /healthz` or authenticated `GET /v1/models`.  
- Copy: fixed remote endpoint; no endpoint editor.

### Local storage

File under app data, e.g. `~/.loom/builtin-gateway.json`:

```json
{
  "installId": "uuid-v4",
  "apiKey": "sk-gw-rt-…",
  "clientId": "rt_…",
  "activatedAt": "…",
  "lastQuotas": { "qps": 5, "daily_requests": 500, "daily_tokens": 0 }
}
```

| Field | Rule |
|-------|------|
| `installId` | Create once on first need; **survive** clear-key |
| `apiKey` | Set on activate; removed on clear |
| Rest | UX / diagnostics |

No project dir, no git, no log of full secrets.

### Protocol: `builtin`

Extend Chat/Agent protocol selection with `builtin` alongside openai / anthropic / ollama / auto.

**Runtime synthesis** (prefer over permanent user profile mutation):

```text
provider: openai-compatible (existing openai path)
endpoint: https://gateway.tanyun.store/v1   // hardcoded constant
apiKey: from builtin-gateway.json
model: user pick from GET /v1/models
```

- Inactive + send → block with CTA to settings.  
- **Auto routing:** v1 does **not** inject builtin into fallback chain unless user explicitly selects `builtin`.  
- List models and streaming reuse existing OpenAI-compatible invoke paths.

### Integration points (indicative)

| Area | Work |
|------|------|
| Constants | `BUILTIN_GATEWAY_BASE = https://gateway.tanyun.store/v1` |
| Client | `activate`, optional health/models helpers |
| State | store or settings slice for activation |
| UI | settings section component + i18n |
| Selectors | protocol option `builtin` + model load |
| Send path | resolve `builtin` → `AIConfig` |
| Usage | optional `provider: builtin` tag |

### User-visible errors

| Case | Message intent |
|------|----------------|
| Not activated | Activate with invite code in settings |
| Bad/exhausted code | Activation failed (gateway message) |
| 401 | Key invalid/revoked — re-activate |
| 429 | Rate or daily quota |
| Network | Built-in service unreachable |

## Security notes

**Do**

- Rate-limit activate  
- Admin revoke  
- Separate invite inventory from issued clients  
- Avoid logging full keys/codes  

**Accept in v1**

- Spoofable `install_id` mitigated by redemption caps + quotas  
- Local disk disclosure same class as any saved API key  
- Fixed hostname outage requires new app build to change default  

## Testing

### Gateway-X

- First activate; rebind same install_id no extra redemption; exhausted code; expiry; disabled  
- Runtime key can call models/chat; disabled key cannot  
- Yaml + runtime merge  
- Activate rate limit  
- Restart retains files  

### Loom

- Block send when inactive  
- Activate → models → chat  
- Clear local → re-activate rebind  
- 401 UX  
- Custom profiles unchanged  

## Implementation milestones

| Milestone | Scope | Demo |
|-----------|--------|------|
| M1 | Gateway-X dual JSON, merge auth, activate API, Admin codes/clients | curl activate + models |
| M2 | Loom installId, settings activate/clear, health | settings loop |
| M3 | `builtin` protocol, models, chat/agent | real built-in chat |
| M4 | i18n, polish, docs, limited invite pilot | external testers |

## Success criteria

1. New user activates with invite only and uses models without configuring upstreams.  
2. No long-lived client key in installer or git.  
3. Same-machine re-activate does not reset daily quota counters; Admin can revoke.  
4. Existing custom protocol profiles behave as today.  

## Related ops paths

| Path | Role |
|------|------|
| `D:\project\Gateway-X` | Gateway service + activate |
| `D:\cloudflared\config.yml` | `gateway.tanyun.store` → 8787 |
| `D:\cloudflared\start-gateway-all.cmd` | Start gateway + tunnel |
| Loom app data | `builtin-gateway.json` |

## Companion copy

A mirror of this design should live (or be linked) under Gateway-X docs for implementers working only in that repo:

`Gateway-X/docs/superpowers/specs/2026-07-23-builtin-gateway-models-design.md`
