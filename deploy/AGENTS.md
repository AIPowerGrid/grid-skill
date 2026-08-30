# deploy - remote MCP production assets

## Purpose

Hardened, reviewable deployment contract for the loopback-only remote MCP
resource. These files are source artifacts, not proof that the service is live.

## Ownership

- `aipg-mcp.service` - systemd process sandbox and loopback runtime contract.
- `nginx-location.conf` - exact public `/v1/mcp` reverse-proxy location,
  installed as `/etc/nginx/aipg-api.d/mcp.conf` under Core's optional overlay.
- `mcp.env.example` - secret-free shape of the protected runtime environment.
- `verify-dark.mjs` - read-only, fail-closed verification of private health,
  the public bearer challenge, hidden health, and disabled OAuth routes.
- `README.md` - staged rollout, verification, and rollback procedure.
- `STATUS.md` - non-secret production rollout snapshot and remaining gates.

## Local Contracts

- Never place an introspection key in git, command examples, process arguments,
  logs, or browser-visible configuration.
- The Node process binds only to loopback. Nginx exposes only `/v1/mcp`; it must
  not expose `/healthz` or a general loopback proxy.
- Keep Core OAuth disabled until migration, Console consent, service-key,
  reverse-proxy, and supervised canary gates are ready.
- Preserve the split between the public OAuth issuer/resource origin and
  `AIPG_MCP_CORE_INTERNAL_URL`. The internal URL is transport-only.
- Preserve immediate SSE response mode, 15-second keepalives, disabled nginx
  buffering, and a proxy read deadline longer than the keepalive interval.
- Core introspection is loopback transport, not a public API. The Core Nginx
  site must shadow `/v1/oauth/introspect` with an exact external `404`; the MCP
  process calls Uvicorn directly through `AIPG_MCP_CORE_INTERNAL_URL`.
- Use an exact reviewed commit already on `main`; never deploy a mutable branch
  name or an npm package version that has not passed the release gate.

## Verification

- `npm test` validates the systemd, nginx, secret-file, and runbook contracts.
- `npm run deploy:verify-dark` checks an installed dark deployment without a
  credential or generation request.
- Keep `STATUS.md` aligned with verified production state; never infer liveness
  from source files alone.
- `systemd-analyze verify deploy/aipg-mcp.service` on Linux before installation.
- `nginx -t` after installing the exact location in Core's reviewed overlay
  directory.
