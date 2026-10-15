<!-- SPDX-FileCopyrightText: 2026 AI Power Grid -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI Power Grid for agents

One small repo with four ways for agents and developers to use AI Power Grid:

- **[`SKILL.md`](./SKILL.md)** - portable, dependency-free HTTP guidance.
- **`aipg`** - CLI for models, quotes, credits, text, image, video, and audio.
- **`aipg-mcp`** - local stdio Model Context Protocol server with the same
  capability surface and shareable media links.
- **`aipg-mcp-http`** - authenticated remote Streamable HTTP MCP resource at
  `https://api.aipowergrid.io/v1/mcp`.

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

For local stdio MCP and unattended automation, use a durable scoped key. Open the
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

Version `0.2.0` adds native browser authorization for the CLI:

```bash
aipg login
aipg auth-status
aipg logout
```

It dynamically registers a public client, requires S256 PKCE, validates the
loopback callback's state, issuer, and host, and stores only the 15-minute Grid
user token in a mode-`0600` local session. There is no client secret or refresh
token. `aipg logout` removes the local session. A `GRID_API_KEY` remains the
explicit fallback for clients that cannot complete browser OAuth.

## CLI

After installation:

```bash
aipg models
aipg credits
aipg quote --model "Krea 2 Turbo" --modality image
aipg text --prompt "Explain Base in one sentence"
aipg image --prompt "a solar-powered compute city at sunrise"
aipg params --model "LTX-2.5 Distilled BF16"
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
- `aipg_get_model_parameters`
- `aipg_quote`
- `aipg_generate_text`
- `aipg_generate_image`
- `aipg_generate_video`
- `aipg_generate_audio`
- `aipg_submit_video_job`
- `aipg_get_video_job`

The discovery, credit, quote, and video-status tools are read-only. Generation
tools are marked as paid operations because they consume Grid credits;
MCP clients can therefore require confirmation instead of treating inference
like a harmless read. Agents should call `aipg_quote` first whenever the user
has set a budget or has not already approved the spend.

Image generation accepts an inline `image` for models advertising `img2img`,
plus batch count, seed, model-gated steps/CFG/sampler, output format and an
optional `max_cost_micro_usd` ceiling. CLI users can supply `--image-file photo.png`.
Editing strength/denoise controls are supported only where the selected model
allows them. Use `aipg_get_model_parameters` or `aipg params --model MODEL`
before choosing advanced settings. For example, the current LTX distilled
contract requires `audio: true`, 24 FPS and eight steps.

For current LTX video models use `aipg_submit_video_job`, then
`aipg_get_video_job`. Submission requires a unique `idempotency_key` and a
positive `max_cost_micro_usd` ceiling (one dollar is 1,000,000 micro-USD).
The request key must be a UUIDv4; generate it once per intended video.
Retrying the same intent/key is idempotent. After a timeout, recover by key
before another submission. A completed response contains media under
`result.media`; MCP also returns those URLs as resource links. Poll no more
often than every five seconds. Admission depends on Core's current policy.

```bash
aipg quote --model "LTX-2.5 Distilled BF16" --modality video --frames 97
VIDEO_REQUEST_ID=$(node -e 'console.log(require("node:crypto").randomUUID())')
aipg video-submit --prompt "a slow camera move through a forest" \
  --model "LTX-2.5 Distilled BF16" --frames 97 \
  --max-cost-micro-usd 100000 --idempotency-key "$VIDEO_REQUEST_ID"
aipg video-status --idempotency-key "$VIDEO_REQUEST_ID"
```

The example ceiling is a limit, not a price or guarantee of admission. Choose
it from the current quote and the human's approved budget.
Video accepts up to 337 frames (recipe-specific alignment and FPS apply),
timed keyframes, and reference audio, video or appearance images when the
selected model supports them. Core checks source duration, dimensions, format,
and allowed combinations. CLI file flags are `--image-file`,
`--reference-audio-file` (WAV), `--reference-video-file` (MP4), and
`--reference-image-file` (PNG). `--keyframes-file pins.json` reads an array
such as `[{"image_file":"start.png","frame":0,"strength":1}]`; image paths
are relative to that JSON file. Inline media must be base64/data URIs, not URLs.

`aipg_generate_video` / `aipg video` retain the synchronous route for models
Core allows there. Model discovery determines availability: an exposed tool
does not mean an audio or video worker is currently online.

### Remote MCP

Use this URL in MCP clients that support remote Streamable HTTP plus OAuth 2.1:

```text
https://api.aipowergrid.io/v1/mcp
```

The resource accepts only Core-issued, 15-minute, audience-bound user tokens.
The server authenticates each MCP HTTP request through Core's introspection
endpoint, requires both `account.read` and `inference.submit`, and forwards that
same user token to Grid. It never accepts or relays a durable Grid API key.

The process is intentionally loopback-only and belongs behind the trusted
`api.aipowergrid.io` reverse proxy:

```bash
export AIPG_MCP_SERVICE_KEY="grid_..."  # grid-mcp; oauth.introspect only
export AIPG_MCP_CORE_INTERNAL_URL="http://127.0.0.1:7010"
export AIPG_MCP_HOST="127.0.0.1"
export AIPG_MCP_PORT="8788"
aipg-mcp-http
```

The local `/healthz` response contains only `{"status":"ok"}`. Host and Origin guards,
a 64 MiB encoded-media budget plus 64 KiB JSON envelope, bounded introspection responses, exact issuer/audience
checks, strict scope enforcement, and fail-closed upstream errors are part of
the server contract. Remote MCP responses use SSE with 15-second keepalives so
long video and audio tools remain active through the public edge. The process
uses the loopback Core URL only as a transport; OAuth issuer, audience,
protected-resource metadata, and the public MCP resource remain pinned to
`https://api.aipowergrid.io`.

At most two requests larger than 256 KiB may remain in flight per process.
Additional large uploads receive `429`; discovery and status reads remain
available. Wait before retrying, and recover uncertain video submissions by key.

This process configuration is for Grid operators, not MCP users. Do not run it
with an ordinary Grid key. Provision `grid-mcp` with
only `oauth.introspect` and store it in the server secret store. Keep Core OAuth
behind its reviewed rollout gate, and repeat the live and rollback verifiers
after changes to Core, Console auth, or MCP. See
[`deploy/STATUS.md`](./deploy/STATUS.md) for the non-secret rollout snapshot.

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

`0.3.0` is published on npm and deployed to the remote MCP endpoint, with ten
tools. See [deployment evidence](deploy/REFRESH_EVIDENCE.md) for the verified
capabilities and the outstanding music-worker renewal. Releases come
only from matching `mcp-vX.Y.Z` tags through GitHub Actions with npm provenance.
The repository workflow is the package's npm Trusted Publisher; no long-lived
npm publish token belongs in GitHub or on a developer workstation.
