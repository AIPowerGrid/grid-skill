# Remote MCP rollout status

Status snapshot: 2026-08-30. This file records reviewed operator evidence; the
machine-checkable live verifier remains the authority for current health.

## Production live

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
  quotes are read-only; text, image, video, and audio tools are paid and
  non-idempotent.
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
