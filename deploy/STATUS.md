# Remote MCP rollout status

Status snapshot: 2026-10-14 (America/New_York). This file records operator evidence; the
machine-checkable live verifier remains the authority for current health.

## Current MCP Release

- PR #19 is merged; `mcp-v0.3.0` and production both select exact commit
  `256433ad710f783d83a83cd27b2b6494a6c1fd6d`. npm publication used GitHub OIDC
  and provenance, not a developer token. The registry tarball SHA-1 is
  `3389606d80663224ed005b89b2eec7c0bbdc68e2`.
- `/opt/aipg-mcp/current` selects that commit under `/opt/aipg-mcp/releases/`.
  Node remains 22.22.0; the existing unprivileged systemd sandbox, loopback
  port 8788 and protected `/etc/aipg/mcp.env` are unchanged.
- The exact nginx overlay now permits 67,174,400 bytes, matching the MCP/Core
  envelope. Large-request concurrency is bounded to two in flight per process.
- Authenticated public verification passed ten-tool discovery, live parameter
  reads, completed-video recovery, credits, quote, 20 same-token requests,
  immediate SSE headers, a tiny paid text call, and a 307,288-byte read-only
  request. Fresh npm stdio discovery/recovery and signatures also pass.
- Gorgadon's audio worker is restored after an owner-approved Ledger
  authorization renewal; payout settings and the worker key are unchanged.
  Public audio discovery and a real ten-second remote MCP generation pass.
- See [media refresh evidence](REFRESH_EVIDENCE.md) for the distinction between
  real generation proof and contract-only controls.
- Scoped MCP rollback: restore release
  `6e03fa95718d39b13b2da5623cb8803d220d334a`, restore proxy overlay from
  `/etc/nginx/aipg-api.d/mcp.conf.pre-0.3.0-20261015`, validate nginx, restart
  only `aipg-mcp.service` and reload nginx. Both previous artifacts remain.

## Historical OAuth Enablement (2026-08-30)

- Core release `4e744feed6e20f6d866a891ebf9b96f34feae376` is deployed with
  `GRID_MCP_OAUTH_ENABLED=1`. OAuth discovery, dynamic public-client
  registration, S256 PKCE, Console consent, 15-minute user tokens, and the
  exact public MCP route are live.
- Grid Skill runtime release `6e03fa95718d39b13b2da5623cb8803d220d334a`
  runs as the unprivileged loopback-only `aipg-mcp` service on the official
  checksum-verified Node.js `v22.22.0` Linux x64 runtime.
- The protected root-owned MCP environment contains one service key carrying
  only `oauth.introspect`. Public Nginx exposes only `/v1/mcp`; MCP health stays
  private and public `/v1/oauth/introspect` returns an exact `404`.
- The supervised Google-backed authorization issued only `account.read` and
  `inference.submit`, returned to an ephemeral loopback callback, and produced
  a token with no refresh token and a 15-minute lifetime.
- `npm run deploy:verify-live` passed seven-tool discovery, credit inspection,
  quote, 20 same-token requests, immediate SSE response headers, and one
  explicit 16-token paid text call below the `$0.03` canary ceiling.
- Separate protocol probes rejected a wrong redirect, plain PKCE, a wrong
  resource, an invalid code, and oversized registration. Ninety-six concurrent
  distinct invalid tokens all returned no-store `401` responses within one
  second wall time.
- The canary found and closed two integration defects before release: Core
  introspection now publishes the canonical public OAuth issuer, and disabling
  OAuth keeps private service-authenticated introspection available solely to
  return `active: false`.
- The rollback drill proved that the same previously valid user token receives
  a no-store `401` after the gate is disabled and becomes usable again only
  after a supervised re-enable. Ordinary Grid API keys were unaffected.
- Natural expiry was checked at `2026-08-30T21:55:55Z`, three seconds after the
  token's exact 15-minute deadline. The expired token received the same
  challenged, no-store `401` response.

## Ongoing obligations

- Monitor authorization failures, rate limits, registration growth, MCP
  latency, and introspection pressure. Never log tokens, account identifiers,
  prompts, outputs, balances, or service credentials.
- Repeat the authenticated live verifier and the off/on rollback drill after
  changes to Core OAuth, Console consent, the MCP runtime, or edge routing.
- Keep generation confirmation in MCP annotations: discovery, credits, and
  quotes are read-only; text, image, synchronous video, and audio tools are
  paid and non-idempotent. Async video submission is paid and key-idempotent;
  recovery is read-only.
- Treat provider/client compatibility as observed evidence, not a universal
  claim. Local stdio MCP with a scoped key remains the fallback for clients
  that do not support remote OAuth.

## Rollback

Set `GRID_MCP_OAUTH_ENABLED=0` and restart Core. Within the MCP verifier's
five-second positive-cache ceiling, all remote user tokens become inactive and
clients receive a no-store `401`; ordinary API keys and first-party service
delegation continue to work. If the MCP process or proxy itself misbehaves,
remove the exact Nginx location, stop `aipg-mcp.service`, and revoke only the
`grid-mcp` introspection key.
