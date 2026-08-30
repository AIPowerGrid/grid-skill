# Remote MCP rollout status

Status snapshot: 2026-08-30. This file records reviewed operator evidence; the
machine-checkable preflight remains the authority for current health.

## Dark deployment complete

- Core release `931ff4cd` is deployed with Alembic `0031` at head and
  `GRID_MCP_OAUTH_ENABLED` unset, which means disabled. Its versioned Nginx
  base proxies only the two exact OAuth discovery routes; both still return
  `404` while the gate is off.
- Grid Skill commit `44cb9c41c6d75edd5cdb761f0e5de549d62a93c1` is installed as an
  immutable production release after its 55 tests, build, package dry run, and
  zero-vulnerability audit passed on the host.
- The runtime is the checksum-verified official Node.js `v22.22.0` Linux x64
  distribution. Its source URL and SHA-256 digest are recorded on the host.
- A dedicated unprivileged `aipg-mcp` service runs the MCP process on loopback.
  The service key is held in a protected root-owned environment file and has
  only the `oauth.introspect` scope.
- Nginx exposes only the exact `/v1/mcp` route through the reviewed
  `/etc/nginx/aipg-api.d/mcp.conf` overlay. MCP health remains private, and
  unrelated `/.well-known/*` paths remain outside Core routing.
- The dark preflight returned `ready_dark`: private health was ready, the public
  route returned the no-store bearer challenge, public health stayed hidden,
  and OAuth discovery and registration stayed disabled.

## Still gated

- Load-test Core introspection and MCP authorization at the intended concurrency.
- Enable OAuth only for an isolated supervised production canary.
- Prove registration, consent approval and denial, S256 PKCE, one-use code
  redemption, wrong verifier, wrong redirect, expiry, revocation, charging, and
  one bounded paid MCP tool call.
- Verify immediate SSE headers and 15-second keepalives through the public edge
  during a deliberately delayed authenticated tool call.
- Review telemetry and database growth, then decide whether to enable the public
  authorization flow.
- Publish npm `0.2.0` and public remote-MCP client instructions only after every
  gate above passes.

## Rollback

Keep OAuth disabled to invalidate all remote-MCP user tokens without affecting
ordinary API keys. If the dark process or proxy misbehaves, remove the exact
Nginx location, stop `aipg-mcp.service`, and revoke the `grid-mcp` service key.
