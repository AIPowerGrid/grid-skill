<!-- SPDX-FileCopyrightText: 2026 AI Power Grid -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# grid-skill

An agent **skill** for the AI Power Grid — teach any coding agent (Claude Code,
Codex, Cursor, …) to generate images/video and run LLM completions on the grid's
OpenAI-compatible API with copy-paste HTTP snippets. No SDK, no MCP server, no
dependencies beyond `curl` + `python3`.

The whole skill is one file: **[`SKILL.md`](./SKILL.md)**. Every snippet in it is
verified against the live API.

## What it covers

- Image generation (basic, save-to-disk, b64, parameters, styles, img2img, and
  the current LoRA limitation)
- Video generation (sync + live progress polling, img2video)
- Chat / LLM completions (streaming + non-streaming; Anthropic & Responses shims)
- Models, styles, workers, live per-model performance, grid totals
- Account credits / usage

## Use it

First, set your key. Open the
[authenticated API-key handoff](https://console.aipowergrid.io/?callbackUrl=%2Fdashboard%2Fapi-key),
sign in with Google, GitHub, or a wallet, and create one. Keep the key in an
environment variable or local secret store; do not paste it into an agent chat.

```bash
export GRID_API_KEY="grid_…"
export GRID_BASE_URL="https://api.aipowergrid.io"
```

**Claude Code** — drop the skill where it's discovered:
```bash
mkdir -p ~/.claude/skills/grid && cp SKILL.md ~/.claude/skills/grid/
# then just ask: "generate an image of X and save it to assets/"
```

**Codex / Cursor / others** — reference `SKILL.md` from your `AGENTS.md` (or paste
its endpoint map into the project prompt). The agent shells out to `curl`; the
snippets are tool-agnostic.

## Design note

We chose a skill over an MCP server on purpose: the grid is already a plain HTTP
API, so a doc of tested snippets is lighter, portable across every agent, and has
nothing to install or keep running. Add new grid capabilities by adding a snippet.
