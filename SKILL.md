---
name: grid
description: >-
  Generate images and video, run LLM chat completions, and query models,
  workers, and credits on the AI Power Grid (api.aipowergrid.io) — an
  OpenAI-compatible decentralized inference API. Use whenever the user wants to
  create an image or video, call a chat/LLM model, or inspect grid status. Every
  action is a single HTTP call; snippets below are copy-paste ready.
---

# AI Power Grid — agent skill

The grid is an **OpenAI-compatible** API for decentralized image, video, and text
generation. If you know the OpenAI API, you know this — with two differences:

1. **Auth header is `apikey:`**, not `Authorization: Bearer`.
2. **Base URL** is `https://api.aipowergrid.io`.

## Setup

```bash
export GRID_API_KEY="grid_…"                     # your key
export GRID_BASE_URL="https://api.aipowergrid.io"
```

All snippets read those two env vars. Get a key from the developer console
(console.aipowergrid.io → API Keys) or ask the grid operator.

## Endpoint map

| Do this | Call |
|---------|------|
| Generate an image | `POST /v1/images/generations` |
| Generate a video | `POST /v1/videos/generations` |
| Chat / LLM completion | `POST /v1/chat/completions` |
| List text models | `GET /v1/models` |
| List image/video models + live perf | `GET /v1/status/models` |
| List curated styles | `GET /v1/styles` |
| Poll generation progress | `GET /v1/progress/{token}` |
| Online workers | `GET /v1/workers` |
| Your credits / usage | `GET /v1/account/credits` |
| Grid totals (day/month) | `GET /v1/stats/totals` |

Current model names (change over time — verify with `/v1/status/models`):
- **Image:** `Krea 2 Turbo` (fast ~8s), `z-image-turbo`, `FLUX.2 Klein 4B FP8`
- **Video:** `LTX-2.3`
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
```bash
curl -s -X POST "$GRID_BASE_URL/v1/images/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"Krea 2 Turbo","prompt":"a friendly robot mascot, flat vector logo","size":"1024x1024"}' \
| python3 -c 'import sys,json,urllib.request as u; d=json.load(sys.stdin)["data"];
[ (u.urlretrieve(x["url"], f"grid_{i}.webp"), print(f"saved grid_{i}.webp  seed={x[\"seed\"]}")) for i,x in enumerate(d) ]'
```

### Get bytes back directly (no second request)
Add `"response_format":"b64_json"` — each `data[i].b64_json` is the base64 image.
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
  "loras": [ … ],                            // CivitAI LoRAs (see below)
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

### LoRAs (CivitAI passthrough)
```jsonc
"loras": [{"name":"add-detail","model":0.8,"clip":0.8,"is_version":false,"inject_trigger":true}]
```
Rejected (not ignored) if the model has no LoRA injection point.

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

Same shape as images, at `/v1/videos/generations`. Video is **slow** (tens of
seconds) — either hold the connection, or poll with a `progress_token`.

### Synchronous (blocks until done)
```bash
curl -s --max-time 180 -X POST "$GRID_BASE_URL/v1/videos/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"LTX-2.3","prompt":"a slow pan over a neon city at night","seconds":4,"fps":24,"size":"768x512"}'
# → {"data":[{"url":"https://media.aipg.art/video/<id>/0.mp4","seed":…}], "grid":{…}}
```

### With live progress (recommended for agents)
```bash
TOKEN="job-$(date +%s)"
# fire the request in the background…
curl -s -X POST "$GRID_BASE_URL/v1/videos/generations" \
  -H "apikey: $GRID_API_KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"LTX-2.3\",\"prompt\":\"ocean waves\",\"seconds\":4,\"progress_token\":\"$TOKEN\"}" > /tmp/vid.json &
# …and poll the percentage
while :; do
  P=$(curl -s "$GRID_BASE_URL/v1/progress/$TOKEN" -H "apikey: $GRID_API_KEY")
  echo "$P"; echo "$P" | grep -q '"done"' && break; sleep 3
done
cat /tmp/vid.json
```
Video params: `seconds` (1–10), `fps` (8–30), `size` (default `768x512`),
`image` (img2video start frame), plus `style`, `seed`, `n` (1–2), `worker`.

### img2video
Pass a start frame as `image` (base64 / `data:` URI), same as img2img.

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

## Account, credits, grid status

```bash
# Your balance + free daily allowance (USD-denominated, micro-USD under the hood)
curl -s "$GRID_BASE_URL/v1/account/credits" -H "apikey: $GRID_API_KEY"
#  → {"free":{"daily_cap_usd":0.25,"remaining_usd":0.25,"resets":"utc-midnight"}, "paid":{"balance_usd":…}}

# Online workers and what each serves
curl -s "$GRID_BASE_URL/v1/workers" -H "apikey: $GRID_API_KEY"

# Live per-model performance (tokens/s, TTFT, latency, worker count)
curl -s "$GRID_BASE_URL/v1/status/models" -H "apikey: $GRID_API_KEY"

# Grid-wide totals (jobs/den/units for day + month, by job type)
curl -s "$GRID_BASE_URL/v1/stats/totals" -H "apikey: $GRID_API_KEY"
```

---

## Gotchas

- **Header:** `apikey: <key>` — not `Authorization: Bearer`. This is the #1 mistake.
- **Model names are exact strings**, spaces and caps included (`"Krea 2 Turbo"`,
  `"FLUX.2 Klein 4B FP8"`). Verify current names with `/v1/status/models`.
- **Media URLs** point at `media.aipg.art`; download promptly if you need to keep
  the asset. Default image format is `webp` (override with `output_format`).
- **Out-of-range params → `422`**, not a silent clamp. Read the error; it tells you
  the allowed band.
- **Free tier** has a small daily cap (see `/v1/account/credits`); beyond it you
  need paid balance. A `402` means out of credits.
- **Video takes real time.** Use `progress_token` + `/v1/progress/{token}` rather
  than a long blocking curl in an interactive agent.
