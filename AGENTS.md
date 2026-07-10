# grid-skill - portable Grid API agent skill

## Purpose

Teach coding agents to use the AI Power Grid public API through concise, tested
HTTP examples. The skill covers text, image, and video generation plus model,
worker, usage, and credit inspection. It is documentation-only: it does not
contain an SDK, credential broker, or runtime service.

## Ownership

- `SKILL.md` - the agent-facing contract. Its YAML description controls when an
  agent should load it; the body contains operational API guidance.
- `README.md` - human-facing installation and scope summary.
- `.github/workflows/` - repository checks, if present.

## Local Contracts

- Inherit org engineering standards from
  `../aipg-documentation/engineering-standards/`.
- Every endpoint, header, request shape, response shape, model name, and limit in
  `SKILL.md` must match the public `/v1` API. Verify examples against code or a
  safe live read before claiming they are current.
- Never place an API key in this repository, examples, URLs, prompts, logs, or
  command history. Examples use `GRID_API_KEY` from the environment.
- Durable keys require a human-authenticated Grid account. Today the human signs
  in at the developer console with Google, GitHub, or a wallet and creates the
  key on the API Keys page. Do not claim an agent device-code flow exists until
  core and console ship it.
- A future agent-connect flow must return only a short-lived, one-time approval
  code before human authentication. Never put the resulting API key in the
  approval URL.
- Keep the skill concise enough to load as one operational reference. Move large
  protocol references out only when the body approaches the skill context limit.

## Work Guidance

- Change `SKILL.md` and `README.md` together when setup or supported capability
  changes.
- Prefer discovery calls such as `/v1/status/models` over hard-coding model
  availability. Any named models are examples, not guarantees.
- Label planned endpoints and flows explicitly. Never provide copy-paste calls
  to an endpoint that is not deployed.
- Preserve the required `name` and `description` YAML frontmatter and use
  imperative instructions in the skill body.

## Verification

- Run `git diff --check`.
- Validate frontmatter with the Codex skill validator when available:
  `python3 /Users/j/.codex/skills/.system/skill-creator/scripts/quick_validate.py .`
- Verify read-only examples safely. Generation examples require an authorized
  test key and may consume credits, so do not run them without explicit intent.

## Child DOX Index

- None - this is a small documentation-only repo.
