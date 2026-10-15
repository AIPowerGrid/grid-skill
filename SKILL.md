---
name: grid
description: >-
  Generate images, video, and audio, run LLM chat completions, and query models,
  workers, and credits on the AI Power Grid (api.aipowergrid.io) — an
  OpenAI-compatible decentralized inference API. Use whenever the user wants to
  create an image or video, call a chat/LLM model, or inspect grid status. Core
  generation calls are synchronous HTTP requests; optional progress polling and
  media downloads use follow-up calls. Snippets below are copy-paste ready.
---

# AI Power Grid — agent skill

The grid is an **OpenAI-compatible** API for decentralized image, video, audio,
and text generation. If you know the OpenAI API, you know this. Authentication accepts:

1. Grid-native `apikey: <key>` (used in the curl examples below).
2. OpenAI-compatible `Authorization: Bearer <key>`; Anthropic Messages also
   accepts `x-api-key: <key>`.

The API origin is `https://api.aipowergrid.io`; OpenAI SDKs use
`https://api.aipowergrid.io/v1` as their base URL.

## Setup

```bash
export GRID_API_KEY="grid_…"                     # your key
export GRID_BASE_URL="https://api.aipowergrid.io"
```

All snippets read those two env vars. A durable key belongs to one canonical
Grid account. Google and a proved wallet can be linked to that account without
duplicating balances or promotional grants. If no key is configured:

1. Give the human this link:
   `https://console.aipowergrid.io/?callbackUrl=%2Fdashboard%2Fapi-key`.
2. Ask them to sign in with Google, GitHub, or a wallet. The callback opens the
   API Keys page, where they create the key.
3. Ask them to store the key in their local secret store or `GRID_API_KEY`
   environment variable. Do not ask them to paste it into chat.

Do not invent, scrape, or request an anonymous key. The published CLI supports
`aipg login`: it opens browser consent using PKCE and stores a 15-minute user
token locally. `aipg auth-status` checks that local session; `aipg logout`
removes it. There is no refresh token; repeat login after expiry. A scoped
`GRID_API_KEY` is the durable option for unattended local MCP and automation.
Remote MCP at `https://api.aipowergrid.io/v1/mcp` requires browser OAuth and
does not accept durable Grid keys. Never ask the human to paste tokens into chat.

## Endpoint map

| Do this | Call |
|---------|------|
| Generate an image | `POST /v1/images/generations` |
| Generate a video | `POST /v1/videos/generations` |
| Submit current LTX video with a spend ceiling | `POST /v1/videos/jobs` |
| Recover a video by request key | `GET /v1/videos/jobs` with `Idempotency-Key` |
| Read a video job | `GET /v1/videos/jobs/{job_id}` |
| Generate audio or music | `POST /v1/audio/generations` |
| Generate a 3D mesh (image→GLB) | `POST /v1/3d/generations` |
| Chat / LLM completion | `POST /v1/chat/completions` |
| List text models | `GET /v1/models` |
| Inspect model controls and source formats | `GET /v1/models/{model_id}/params` |
| List image/video models + live perf | `GET /v1/status/models` |
| List curated styles | `GET /v1/styles` |
| Poll generation progress | `GET /v1/progress/{token}` |
| Online workers | `GET /v1/workers` |
| Your credits / usage | `GET /v1/account/credits` |
| Grid totals (day/month) | `GET /v1/stats/totals` |

Current model names (change over time — verify with `/v1/status/models`):
- **Image:** `Krea 2 Turbo` (fast ~8s), `z-image-turbo`, `FLUX.2 Klein 4B FP8`
- **Video:** discover current model names and source modes; `LTX-2.5 Distilled BF16`
  uses the asynchronous job route, subject to Core admission.
- **Audio:** discover the live ACE-Step model with `/v1/status/models`
- **3D:** `TRELLIS2` is an HTTP capability; use it only when discovery shows a worker.
- **Text:** `auto` (router), `gpt-oss-120b`, `gpt-oss-20b`, `deepseek-v4-flash-nvfp4`

---

## Images

### Generate (returns a URL)
```bash
curl -s -X POST "$GRID_BASE_URL/v1/images/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"Krea 2 Turbo","prompt":"a red cube on a white table","size":"1024x1024","n":1}'
```
Response:
```json
{"created":1783539790,
 "data":[{"url":"https://media.aipg.art/image/<id>/0.webp","seed":2802980433866141,
          "revised_prompt":"a red cube on a white table"}],
 "grid":{"worker":"half5090beast1","gen_time":7.64,"model":"Krea 2 Turbo"}}
```

### Generate AND save to disk (what you usually want in an agent)
Two steps — generate, then `curl` the URL down. **Download with `curl`, not bare
`python urllib`**: `media.aipg.art` (Cloudflare) 403s the default `Python-urllib`
User-Agent (see Gotchas).
```bash
RESP=$(curl -s -X POST "$GRID_BASE_URL/v1/images/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"Krea 2 Turbo","prompt":"a friendly robot mascot, flat vector logo","size":"1024x1024"}')
URL=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["url"])')
curl -s -o grid.webp "$URL" && echo "saved grid.webp  ($URL)"
```

### Get bytes back directly (no second request, no download gotcha)
Add `"response_format":"b64_json"` — each `data[i].b64_json` is the base64 image,
inline in the response. No media fetch at all.
```bash
curl -s -X POST "$GRID_BASE_URL/v1/images/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"Krea 2 Turbo","prompt":"a red cube","response_format":"b64_json","output_format":"png"}' \
| python3 -c 'import sys,json,base64; d=json.load(sys.stdin)["data"][0];
open("out.png","wb").write(base64.b64decode(d["b64_json"])); print("wrote out.png")'
```

### All image parameters
```jsonc
{
  "model": "FLUX.2 Klein 4B FP8",
  "prompt": "…",
  "negative_prompt": "blurry, watermark",   // what to avoid
  "n": 1,                                    // 1–4
  "size": "832x1216",                        // WxH; e.g. 1024x1024, 1216x832 (landscape)
  "seed": 12345,                             // omit for random; echoed back for repro
  "steps": 6,                                // gated per model (rejected if out of range)
  "cfg_scale": 1.2,                          // prompt adherence, gated per model
  "sampler": "euler",                        // allow-listed per model
  "output_format": "webp",                   // png | jpeg | webp (default webp)
  "response_format": "url",                  // url | b64_json
  "style": "3d-render",                      // curated preset (see Styles); expands server-side
  "image": "data:image/png;base64,…",        // img2img / edit source (see below)
  "loras": [ … ],                            // known limitation; see below
  "worker": "half5090beast1"                 // soft-prefer a worker you own
}
```
Numeric knobs are **range-gated per model** — an out-of-band value returns `422`
(you are told), it is not silently clamped. Sampler is allow-listed the same way.

### img2img / edit
Pass a source frame as `image` (inline base64 or a `data:` URI). Requires a model
that advertises image input (e.g. `FLUX.2 Klein 4B FP8`).
```bash
IMG="data:image/png;base64,$(base64 -i input.png)"
curl -s -X POST "$GRID_BASE_URL/v1/images/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"FLUX.2 Klein 4B FP8\",\"prompt\":\"make it snowy\",\"image\":\"$IMG\"}"
```

### LoRAs (not ready on the recipe executor)

Do not send `loras` for current resolved-recipe jobs. Core validates the field
and can advertise an injection point, but the media worker's recipe executor
does not yet splice the LoRA loader and warns instead. Treat this as unsupported
until the worker implementation and end-to-end tests land; accepting a request
without applying it would be misleading.

---

## Styles (curated presets)

A style locks a model + tuned params behind a friendly id, so you get a look
without hand-setting knobs.

```bash
curl -s "$GRID_BASE_URL/v1/styles" -H "apikey: $GRID_API_KEY"        # list all
curl -s "$GRID_BASE_URL/v1/styles?job_type=video" -H "apikey: $GRID_API_KEY"
```
```jsonc
// each: {"id":"3d-render","name":"3D Render","model":"FLUX.2 Klein 4B FP8","job_type":"image","aspect":"1:1", …}
```
Use one by passing `"style":"3d-render"` to the image/video call — it sets the
model and params server-side (your explicit fields still win).

---

## Video

Discover the exact model and source modes before a request. Current LTX jobs
use durable asynchronous submission. Quote the intended frame count, set a
human-approved `max_cost_micro_usd`, and generate one unique UUIDv4 request key.
The ceiling is enforced by Core; a quote alone does not reserve or limit spend.
Inspect `/v1/models/{model_id}/params` (URL-encode the model name), or use
`aipg_get_model_parameters`. The current distilled contract requires audio
enabled, 24 FPS and eight steps; other model variants may differ.

```bash
curl --fail-with-body -s "$GRID_BASE_URL/v1/account/credits/quote" \
  -H "Authorization: Bearer $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"LTX-2.5 Distilled BF16","modality":"video","frames":97}'

# The illustrative $0.10 ceiling below must fit the quote and approved budget.
VIDEO_REQUEST_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
curl --fail-with-body -s "$GRID_BASE_URL/v1/videos/jobs" \
  -H "Authorization: Bearer $GRID_API_KEY" -H "Idempotency-Key: $VIDEO_REQUEST_ID" \
  -H "Content-Type: application/json" \
  -d '{"model":"LTX-2.5 Distilled BF16","prompt":"ocean waves at sunrise","frames":97,"max_cost_micro_usd":100000}'

# Recover or poll the same request; no new job is submitted.
curl --fail-with-body -s "$GRID_BASE_URL/v1/videos/jobs" \
  -H "Authorization: Bearer $GRID_API_KEY" -H "Idempotency-Key: $VIDEO_REQUEST_ID"
```

Retain the generated UUID for recovery. Poll at intervals of at least five
seconds. `state: completed` contains the
generation envelope at `result`, with links under `result.media[].url`.
`closed_without_result` is terminal; `execution_uncertain` is not permission to
submit a fresh job. After a timeout or lost response, recover using the same
key. Never retry automatically with a new key. Core may restrict admission
even while model discovery shows a worker.

Video controls include `frames` (9–337; recipe alignment applies), `seconds`
(positive, at most 337/24), `fps` (8–30), `size`, seed, and model-supported
conditioning. `image` pins a first frame. `keyframes` contains at most 16
`{image, frame, strength}` entries; frame is 0–336 and strength is 0–1.
Do not combine `image` and `keyframes`. References are `reference_audio`
(WAV), `reference_video` (MP4), and `reference_image` (PNG appearance sheet).
All are inline base64/data URIs. Core validates source dimensions, duration,
recipe limits and allowed combinations; it does not accept arbitrary media URLs.

The shared encoded-media budget is 64 MiB with a 64 KiB JSON envelope.
Individual decoded references are limited to 12 MiB audio/image and 32 MiB
video. Do not put inline media in shell arguments. CLI `--image-file`,
`--reference-audio-file`, `--reference-video-file`, `--reference-image-file`
and `--keyframes-file` load bounded local files.

MCP `aipg_submit_video_job` and `aipg_get_video_job` expose submission and
recovery. The synchronous `aipg_generate_video` tool remains available for
models admitted by `/v1/videos/generations`; its progress token API is not the
asynchronous job status API.

---

## 3D (image → mesh)

`POST /v1/3d/generations` turns a **single image** into a textured 3D mesh (**GLB**)
via TRELLIS. There is **no prompt** — it's image-conditioned only. It's **slow**
(~100s+) and GPU-heavy, so prefer `progress_token` polling for a UI.

```bash
IMG="data:image/png;base64,$(base64 -i photo.png)"
curl -s --max-time 960 -X POST "$GRID_BASE_URL/v1/3d/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"TRELLIS2\",\"image\":\"$IMG\"}"
# → {"data":[{"url":"https://media.aipg.art/.../0.glb","seed":…}],
#    "grid":{"worker":"gorgadon-trellis","gen_time":101,"model":"TRELLIS2"}}
```

Download + view the mesh:
```bash
curl -s -o out.glb "$URL"   # open in Blender, https://gltf-viewer.donmccurdy.com, or <model-viewer>
```

Params (all optional except `image`):
| param | notes |
|-------|-------|
| `image` | **required** — source image (base64 / `data:` URI). No prompt. |
| `steps` | 4–30 — shape sampling steps (default 12) |
| `guidance` | 1–10 — classifier-free guidance (default ~6.5) |
| `target_faces` | 5000–300000 — mesh decimation target |
| `seed` | omit for random; folded into TRELLIS's range, echoed back |
| `progress_token` | poll `GET /v1/progress/{token}` — **use this**, don't block for 100s |

Output is a `.glb` (glTF binary) on `media.aipg.art`. Out-of-range knobs return
`422` (not silently clamped), same as image/video.

---

## Chat / LLM (text)

Standard OpenAI chat completions.

### Non-streaming
```bash
curl -s -X POST "$GRID_BASE_URL/v1/chat/completions" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Explain a merkle tree in one line."}],"max_tokens":200}' \
| python3 -c 'import sys,json; print(json.load(sys.stdin)["choices"][0]["message"]["content"])'
```
`model:"auto"` lets the grid route to a suitable model. Or name one directly
(`gpt-oss-120b`, `deepseek-v4-flash-nvfp4`, …).

### Streaming (SSE)
```bash
curl -sN -X POST "$GRID_BASE_URL/v1/chat/completions" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"auto","stream":true,"messages":[{"role":"user","content":"Count to 5."}]}'
# → data: {"choices":[{"delta":{"content":"1"}}]} …  data: [DONE]
```

Also available (drop-in for their SDKs): **Anthropic Messages** at
`POST /v1/messages`, **OpenAI Responses** at `POST /v1/responses`.

---

## Audio / music

Generate WAV audio at `POST /v1/audio/generations`. Discover the currently
online model before naming one; omit `model` to use Core's governed default.

```bash
curl -s --max-time 1980 -X POST "$GRID_BASE_URL/v1/audio/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"hopeful instrumental post-rock, clean guitars, steady drums","seconds":30,"bpm":96,"key_scale":"A minor"}'
# -> {"data":[{"url":"https://media.aipg.art/.../0.wav","seed":...}],"grid":{...}}
```

For vocals, add `lyrics` and a lowercase two-letter `vocal_language`. Useful controls are
`seconds` (10-300), `inference_steps`, `bpm`, `key_scale`, `time_signature`
(`2/4`, `3/4`, `4/4`, or `6/8`), `vocal_language`, and `seed`. Generation can
take longer than text; set a generous client timeout. Return and retain the
HTTPS media URL rather than requesting inline base64 audio.

If the local `aipg-mcp` server is installed, prefer its typed tools for routine
calls. Use these HTTP examples as the portable fallback and protocol reference.

---

## Account, credits, grid status

```bash
# Your promotional, daily-free, and purchased pockets (USD-denominated)
curl -s "$GRID_BASE_URL/v1/account/credits" -H "apikey: $GRID_API_KEY"
#  → {"promotional":{"remaining_usd":…,"active":false},
#      "free":{"remaining_usd":…,"active":false},"paid":{"balance_usd":…},
#      "total_spendable_usd":…,"total_preview_usd":…}

# Online workers and what each serves
curl -s "$GRID_BASE_URL/v1/workers" -H "apikey: $GRID_API_KEY"

# Live per-model performance (tokens/s, TTFT, latency, worker count)
curl -s "$GRID_BASE_URL/v1/status/models" -H "apikey: $GRID_API_KEY"

# Grid-wide totals (jobs/den/units for day + month, by job type)
curl -s "$GRID_BASE_URL/v1/stats/totals" -H "apikey: $GRID_API_KEY"
```

---

## Gotchas

- **Headers:** curl examples use `apikey: <key>`, while OpenAI SDKs naturally
  send `Authorization: Bearer <key>`; both are supported. Anthropic SDKs may use
  `x-api-key` on `/v1/messages`.
- **Model names are exact strings**, spaces and caps included (`"Krea 2 Turbo"`,
  `"FLUX.2 Klein 4B FP8"`). Verify current names with `/v1/status/models`.
- **Media URLs** point at `media.aipg.art`; download promptly if you need to keep
  the asset. Default image format is `webp` (override with `output_format`).
- **Downloading media: use `curl`** (or set a `User-Agent`). `media.aipg.art` is
  Cloudflare-fronted and returns **403** to the default `Python-urllib` agent.
  `curl -o file "$URL"` works; `urllib.request.urlretrieve(url)` does not unless you
  add a `User-Agent` header. Or avoid the fetch with `response_format:"b64_json"`.
- **Out-of-range params → `422`**, not a silent clamp. Read the error; it tells you
  the allowed band.
- **Credit gates:** inspect `promotional.active`, `free.active`,
  `total_spendable_usd`, and `total_preview_usd` from `/v1/account/credits`.
  A displayed pocket can be preview-only while its rollout gate is off. A `402`
  means the request could not reserve enough currently spendable credit.
- **Video takes real time.** Use `progress_token` + `/v1/progress/{token}` rather
  than a long blocking curl for legacy synchronous video. Current LTX uses the
  asynchronous job/status flow above.
