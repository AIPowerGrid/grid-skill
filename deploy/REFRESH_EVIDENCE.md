# MCP Media Refresh Evidence

Verification date: October 14, 2026 (America/New_York).

This is candidate evidence, not a production deployment or npm publication.
The remote production MCP still reports seven tools from release 0.2.0.
Candidate 0.3.0 exposes ten tools. Main/source, release and runtime state must
be verified separately before directory submissions.

## Candidate Checks

- Node 22: type check, 66 tests across ten files, build and package dry run pass.
- npm dependency audit: zero known advisories at verification time.
- Full reachable existing history and staged candidate diff pass gitleaks.
- Portable skill frontmatter validates; Git whitespace checks pass.
- Contract tests cover image editing/batches, frame quotes, UUIDv4 submission
  and GET-only recovery, nested async video media links, file-size limits,
  large-request concurrency, authentication and SSE response behavior.

## Live Checks

- Fresh Google-backed PKCE authorization completed with account.read and
  inference.submit, a 15-minute lifetime, and no refresh token.
- Existing public remote MCP initialized, listed its seven tools and read
  credits with that token. Invalid/missing credentials are rejected.
- The ten-tool candidate ran as a real stdio subprocess using the isolated
  OAuth session and called the production Grid API.
- gpt-oss-120b returned the requested visible text in 2.64 seconds.
- FLUX.2 Klein edited the public AIPG logo and returned a media URL in 9.30
  seconds. Its request included the server-enforced 10,000 micro-USD ceiling.
- LTX-2.5 Distilled BF16 completed a nine-frame 768x448 video with generated
  audio. The async hold and final charge were both 7,500 micro-USD. Polling used
  the original request key; recovery returned the completed media resource link.
- Z-Image Turbo completed a two-image batch and exposed two resource links,
  with a server-enforced 6,000 micro-USD ceiling.
- Downloaded canary media is readable: the edit is a 1024x1024 WebP with the
  requested visible silver logo; ffprobe confirms nine 768x448 H.264 frames at
  24 FPS with AAC audio. The downloaded video's SHA-256 matches its receipt.
- These requests fit the approved $0.03 aggregate canary budget. Rejected video
  probes were recovered as absent before correcting inputs; no duplicate
  accepted submission was made.

## Remaining Verification

- Music is not live-verified. Gorgadon's audio service is running but Core
  rejects its expired delegation. The existing certificate also names an older
  payout address than the account's current configured address. A new request
  must bind the same worker key/name to the current payout wallet and be signed
  by that wallet before it is installed. Do not extend or bypass an expired
  certificate or silently change account ownership/payout settings.
- After owner review and green hosted CI, publish the candidate through the
  matching provenance workflow and deploy the exact main commit plus matching
  nginx overlay. Repeat authenticated remote discovery and media checks.
- Verify the fresh npm tarball before listing the updated service. Runtime
  tools alone do not prove worker availability.
