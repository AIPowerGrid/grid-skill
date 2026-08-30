# Remote MCP rollout

This procedure deploys the remote MCP process without enabling OAuth. It does
not publish npm `0.2.0`, grant inference authority to a service account, or make
the authorization flow live by itself.

## Preconditions

1. Core migration `0031` is applied from an exact reviewed release while
   `GRID_MCP_OAUTH_ENABLED=0`.
2. Core OAuth discovery, registration, and authorization routes return `404`
   while disabled.
3. The Console consent route is deployed with its existing bounded
   `grid-console` service key and delegated-user-token exchange.
4. Node.js 22 LTS is installed from a reviewed distribution source at
   `/usr/bin/node`. Record the exact runtime version and package provenance in
   the deployment evidence; do not use a `curl | sh` installer.
5. The selected Grid Skill commit is already reachable from `origin/main` and
   passes `npm run check` plus `npm audit --audit-level=low`.

## Install an immutable release

Create a dedicated unprivileged `aipg-mcp` user and release root. Check out an
exact commit into `/opt/aipg-mcp/releases/<commit>`, then run:

```bash
npm ci
npm run check
npm audit --audit-level=low
npm prune --omit=dev
```

Confirm `node --version` reports the reviewed Node 22 LTS build before enabling
the service. The systemd unit refuses to start when `/usr/bin/node` or the
immutable release directory is missing.

Point `/opt/aipg-mcp/current` at that exact release only after the checks pass.
Do not install from a branch name or from unpublished npm `0.2.0`.

## Provision the introspection principal

From the matching Core release, provision exactly one backend principal:

```bash
python scripts/create_service_account.py \
  --id grid-mcp \
  --name "Grid remote MCP" \
  --scope oauth.introspect
```

Capture the command output directly into a root-only file rather than an
interactive terminal or deployment log. Copy only the one-time `api_key` value
into `/etc/aipg/mcp.env` as `AIPG_MCP_SERVICE_KEY`. Set ownership to
`root:aipg-mcp`, mode `0640`, then destroy the temporary capture. Never reuse a
Console, frontend, user, or inference-capable key.

## Install dark

1. Install `aipg-mcp.service` as `/etc/systemd/system/aipg-mcp.service`.
2. Run `systemd-analyze verify` against the installed unit.
3. Start the service and verify `curl --fail http://127.0.0.1:8788/healthz`
   returns exactly `{"status":"ok"}`.
4. Add `nginx-location.conf` inside the production API TLS server block and run
   `nginx -t` before reload.
5. Verify `/healthz` is not reachable through the public API origin.
6. Request `https://api.aipowergrid.io/v1/mcp` without a bearer token. It must
   return `401`, `Cache-Control: no-store`, and a `WWW-Authenticate` challenge
   pointing at the Core protected-resource metadata URL.
7. Confirm OAuth discovery still returns `404`. Stop if any authorization,
   registration, or token route becomes public before the canary window.

## Supervised enablement

Enable OAuth only for the isolated canary described in Core's
`docs/architecture/REMOTE_MCP_AUTH.md`. Prove registration, S256 PKCE consent,
denial, one-use code redemption, wrong verifier, wrong redirect, expiry,
revocation, charging, and one bounded MCP tool call before publishing npm
`0.2.0` or documenting the remote URL as generally available.

## Rollback

1. Set `GRID_MCP_OAUTH_ENABLED=0` and restart Core. Existing OAuth access tokens
   then fail introspection without affecting ordinary API keys.
2. Remove the nginx exact location and reload only after `nginx -t` passes.
3. Stop and disable `aipg-mcp.service`.
4. Revoke the `grid-mcp` service key. Do not delete audit or OAuth tables during
   an incident rollback.
