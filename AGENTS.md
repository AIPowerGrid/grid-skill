# grid-skill - Grid agent skill, CLI, and MCP server

## Purpose

Give agents a small, auditable way to discover and use AI Power Grid. The repo
owns the portable HTTP skill, the `aipg` CLI, and the local stdio MCP server for
text, image, video, audio, model discovery, quotes, and credit inspection.

## Ownership

- `SKILL.md` - the agent-facing contract. Its YAML description controls when an
  agent should load it; the body contains operational API guidance.
- `src/client.ts` - fixed-origin Grid HTTP client and request contracts.
- `src/mcp.ts` - MCP tool definitions. Keep tools thin; API behavior belongs to
  Core, not this adapter.
- `src/stdio.ts` - local MCP stdio entry point.
- `src/remote-auth.ts` - fail-closed Core token introspection and MCP auth info.
- `src/remote.ts` - loopback-bound, authenticated Streamable HTTP MCP server.
- `src/http.ts` - remote MCP process entry point.
- `src/cli.ts` - human and automation CLI entry point.
- `tests/` - protocol, credential-safety, and request-contract coverage.
- `README.md` - human-facing setup, installation, and security boundaries.
- `.github/workflows/` - repository checks plus the tag-gated npm provenance
  release for `@aipowergrid/mcp`.
- `deploy/` - hardened systemd, nginx, protected-environment shape, and rollout
  runbook for the loopback remote MCP process. Owned in its own `AGENTS.md`.

## Local Contracts

- Inherit org engineering standards from
  `../aipg-documentation/engineering-standards/`.
- Every endpoint, header, request shape, response shape, model name, and limit in
  `SKILL.md` must match the public `/v1` API. Verify examples against code or a
  safe live read before claiming they are current.
- Never place an API key in this repository, examples, URLs, prompts, logs, or
  command history. Examples use `GRID_API_KEY` from the environment.
- Never accept a key as a CLI argument. The local CLI and stdio server read it
  from `GRID_API_KEY` so process listings and shell history do not expose it.
- Production API traffic is pinned to `https://api.aipowergrid.io`. Alternate
  origins are allowed only on loopback for tests. Reject redirects and return
  URL media output rather than unbounded base64 payloads.
- Durable keys require a human-authenticated Grid account. Today the human signs
  in at the developer console with Google, GitHub, or a wallet and creates the
  key on the API Keys page. Do not claim an agent device-code flow exists until
  core and console ship it.
- Native browser authorization is staged in `src/auth.ts` for `0.2.0` but is
  not public while Core's OAuth gate is off. It uses dynamic public-client
  registration, S256 PKCE, an ephemeral loopback callback, exact state/issuer
  validation, and a 15-minute user token without refresh. Never put a Grid API
  key or access token in the authorization URL.
- The remote HTTP MCP server accepts only short-lived, audience-bound Grid user
  tokens. It introspects through a separate `grid-mcp` service key carrying
  only `oauth.introspect`, requires `account.read` plus `inference.submit`, and
  forwards the same user token to Core. Never add durable API-key passthrough,
  service-account inference, identity assertions, or refresh-token storage.
- Keep the remote process bound to loopback and expose only `/v1/mcp` through
  the trusted API reverse proxy. Preserve exact issuer/audience checks, Host and
  Origin guards, bounded bodies, no-store auth errors, and fail-closed
  introspection behavior.
- npm releases come only from a matching `mcp-vX.Y.Z` tag through the pinned
  OIDC publication workflow. `0.1.1` is public; source `0.2.0` must remain
  unpublished until the supervised OAuth and remote-MCP rollout passes. Do not
  restore the revoked bootstrap token or a repository `NPM_TOKEN` secret.
- Keep the skill concise enough to load as one operational reference. Move large
  protocol references out only when the body approaches the skill context limit.

## Work Guidance

- Change `SKILL.md`, `README.md`, and MCP/CLI tools together when setup or the
  supported capability surface changes.
- Prefer discovery calls such as `/v1/status/models` over hard-coding model
  availability. Any named models are examples, not guarantees.
- Label planned endpoints and flows explicitly. Never provide copy-paste calls
  to an endpoint that is not deployed.
- Preserve the required `name` and `description` YAML frontmatter and use
  imperative instructions in the skill body.

## Verification

- Run `git diff --check`.
- Run `npm run check` and `npm audit --audit-level=low`.
- Validate frontmatter with the Codex skill validator when available:
  `python3 /Users/j/.codex/skills/.system/skill-creator/scripts/quick_validate.py .`
- Verify read-only examples safely. Generation examples require an authorized
  test key and may consume credits, so do not run them without explicit intent.

## Child DOX Index

- [deploy/AGENTS.md](deploy/AGENTS.md) - production assets and dark rollout
  contract for the remote MCP HTTP resource.
