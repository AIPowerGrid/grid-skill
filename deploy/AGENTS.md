# deploy - remote MCP production assets

## Purpose

Hardened, reviewable deployment contract for the loopback-only remote MCP
resource. These files are source artifacts, not proof that the service is live.

## Ownership

- `aipg-mcp.service` - systemd process sandbox and loopback runtime contract.
- `nginx-location.conf` - exact public `/v1/mcp` reverse-proxy location.
- `mcp.env.example` - secret-free shape of the protected runtime environment.
- `README.md` - staged rollout, verification, and rollback procedure.

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
- Use an exact reviewed commit already on `main`; never deploy a mutable branch
  name or an npm package version that has not passed the release gate.

## Verification

- `npm test` validates the systemd, nginx, secret-file, and runbook contracts.
- `systemd-analyze verify deploy/aipg-mcp.service` on Linux before installation.
- `nginx -t` after placing the location inside the production API server block.
