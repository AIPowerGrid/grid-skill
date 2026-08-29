<!-- SPDX-FileCopyrightText: 2026 AI Power Grid -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI Power Grid for agents

One small repo with three ways for agents and developers to use AI Power Grid:

- **[`SKILL.md`](./SKILL.md)** - portable, dependency-free HTTP guidance.
- **`aipg`** - CLI for models, quotes, credits, text, image, video, and audio.
- **`aipg-mcp`** - local stdio Model Context Protocol server with the same
  capability surface and shareable media links.

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

## Authenticate once

First, set your key. Open the
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
That keeps credentials out of process listings and shell history.

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

Remote HTTP MCP is deliberately not exposed yet. A remote server must use
short-lived, audience-bound authorization; relaying durable Grid API keys would
violate MCP's authorization model and create a credential-broker liability.

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

`@aipowergrid/mcp` is published from matching `mcp-vX.Y.Z` tags through GitHub
Actions with npm provenance. The repository workflow is the package's npm
Trusted Publisher; no long-lived npm publish token belongs in GitHub or on a
developer workstation.
