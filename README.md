<!-- SPDX-FileCopyrightText: 2026 AI Power Grid -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI Power Grid for agents

One small repo with four ways for agents and developers to use AI Power Grid:

- **[`SKILL.md`](./SKILL.md)** - portable, dependency-free HTTP guidance.
- **`aipg`** - CLI for models, quotes, credits, text, image, video, and audio.
- **`aipg-mcp`** - local stdio Model Context Protocol server with the same
  capability surface and shareable media links.
- **`aipg-mcp-http`** - staged remote Streamable HTTP MCP resource. It is dark
  until the Core OAuth and Console consent rollout passes.

Install the signed package from npm:

```bash
npm install --global @aipowergrid/mcp
```

## What it covers

- Image generation (basic, save-to-disk, b64, parameters, styles, img2img, and
  the current LoRA limitation)
- Video generation (sync + live progress polling, img2video)
- Audio and music generation with ACE-Step controls
- 3D mesh generation (image→GLB via TRELLIS)
- Chat / LLM completions (streaming + non-streaming; Anthropic & Responses shims)
- Models, styles, workers, live per-model performance, grid totals
- Account credits / usage

## Authentication

The published `0.1.x` package uses a durable scoped key. Open the
[authenticated API-key handoff](https://console.aipowergrid.io/?callbackUrl=%2Fdashboard%2Fapi-key),
sign in with Google, GitHub, or a wallet, and create one. Keep the key in an
environment variable or local secret store; do not paste it into an agent chat.
Google and a proved wallet can share one canonical account and its promotional,
daily-free, and purchased credit pockets.

```bash
export GRID_API_KEY="grid_…"
export GRID_BASE_URL="https://api.aipowergrid.io"
```

The CLI and stdio MCP intentionally do not accept keys on the command line.
That keeps credentials out of process listings and shell history. Commands use
strict flag allowlists: `--api-key`, duplicate flags, misspelled flags, and
flags belonging to another command are rejected before authentication or any
network request.

Version `0.2.0` is staged in source with native browser authorization:

```bash
aipg login
aipg auth-status
aipg logout
```

It dynamically registers a public client, requires S256 PKCE, validates the
loopback callback's state, issuer, and host, and stores only the 15-minute Grid
user token in a mode-`0600` local session. There is no client secret or refresh
token. Core and Console keep this flow dark until the supervised OAuth rollout
passes, so the current npm release still requires `GRID_API_KEY`; do not publish
`0.2.0` or describe browser login as live before that gate closes.

## CLI

After installation:

```bash
aipg models
aipg credits
aipg quote --model "Krea 2 Turbo" --modality image
aipg text --prompt "Explain Base in one sentence"
aipg image --prompt "a solar-powered compute city at sunrise"
aipg video --prompt "slow camera move through a neon server hall" --seconds 4
aipg audio --prompt "hopeful instrumental post-rock" --seconds 30
```

Every generation command prints the canonical Grid JSON response. Media
responses contain HTTPS URLs that agents can display, download, or share.

## MCP

Configure your MCP client to execute:

```json
{
  "mcpServers": {
    "aipowergrid": {
      "command": "aipg-mcp",
      "env": {
        "GRID_API_KEY": "${GRID_API_KEY}"
      }
    }
  }
}
```

The exact environment-variable interpolation syntax varies by client. Prefer
the client's local secret store where available; never commit the expanded
value. The server exposes:

- `aipg_list_models`
- `aipg_get_credits`
- `aipg_quote`
- `aipg_generate_text`
- `aipg_generate_image`
- `aipg_generate_video`
- `aipg_generate_audio`

The discovery, credit, and quote tools are read-only. Every generation tool is
marked as a paid, non-idempotent operation because it consumes Grid credits;
MCP clients can therefore require confirmation instead of treating inference
like a harmless read. Agents should call `aipg_quote` first whenever the user
has set a budget or has not already approved the spend.

### Remote MCP rollout

Source `0.2.0` includes the remote Streamable HTTP resource, but it is not
deployed or public yet. It accepts only Core-issued, 15-minute, audience-bound
user tokens. The server authenticates each MCP HTTP request through Core's
introspection endpoint, requires both `account.read` and `inference.submit`,
and forwards that same user token to Grid. It never accepts or relays a durable
Grid API key.

The process is intentionally loopback-only and belongs behind the trusted
`api.aipowergrid.io` reverse proxy:

```bash
export AIPG_MCP_SERVICE_KEY="grid_..."  # grid-mcp; oauth.introspect only
export AIPG_MCP_CORE_INTERNAL_URL="http://127.0.0.1:7010"
export AIPG_MCP_HOST="127.0.0.1"
export AIPG_MCP_PORT="8788"
aipg-mcp-http
```

The public route will be `https://api.aipowergrid.io/v1/mcp`. The local
`/healthz` response contains only `{"status":"ok"}`. Host and Origin guards,
a 256 KiB request limit, bounded introspection responses, exact issuer/audience
checks, strict scope enforcement, and fail-closed upstream errors are part of
the server contract. Remote MCP responses use SSE with 15-second keepalives so
long video and audio tools remain active through the public edge. The process
uses the loopback Core URL only as a transport; OAuth issuer, audience,
protected-resource metadata, and the public MCP resource remain pinned to
`https://api.aipowergrid.io`.

Do not run this command with an ordinary Grid key. Provision `grid-mcp` with
only `oauth.introspect`, store it in the server secret store, and keep the
reverse-proxy route dark until Core migration `0031`, Console consent, OAuth
canary, charging, expiry, denial, and revocation tests all pass.

## Portable skill

**Claude Code** — drop the skill where it's discovered:
```bash
mkdir -p ~/.claude/skills/grid && cp SKILL.md ~/.claude/skills/grid/
# then just ask: "generate an image of X and save it to assets/"
```

**Codex / Cursor / others** — reference `SKILL.md` from your `AGENTS.md` (or paste
its endpoint map into the project prompt). The agent shells out to `curl`; the
snippets are tool-agnostic.

The skill remains the zero-install option. MCP gives compatible agents typed
tools and structured output; the CLI gives humans and automation a stable shell
surface. All three call the same public API and keep Core as the source of truth.

## Package release status

`@aipowergrid/mcp@0.1.1` is the current public release. Source is bumped to
unpublished `0.2.0` for the dark browser-authorization and remote-MCP rollout.
Releases come
only from matching `mcp-vX.Y.Z` tags through GitHub Actions with npm provenance.
The repository workflow is the package's npm Trusted Publisher; no long-lived
npm publish token belongs in GitHub or on a developer workstation.
