# MCP Media Refresh Evidence

Verification date: October 14, 2026 (America/New_York).

Release 0.3.0 is published and deployed. PR #19 merged as
`256433ad710f783d83a83cd27b2b6494a6c1fd6d`; the matching `mcp-v0.3.0` tag
published through GitHub Actions with npm provenance. Both a fresh registry
installation and public remote MCP independently report version 0.3.0 and ten
tools. This does not imply that every modality has an online worker.

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

## Music Recovery

- The owner reviewed and signed the exact worker-only delegation on their
  connected Ledger. The signature was independently recovered to the expected
  wallet before installation through the manager's supported identity command.
  The certificate retains the existing worker key/name and has a 90-day term;
  the expired certificate is preserved privately for incident review.
- The browser's selected wallet was different from the account payout wallet.
  Its replacement prompt was not approved. Direct Ledger signing avoided any
  payout-account mutation, software-wallet import, private-key export or funds
  transfer. No signature or private worker credential belongs in this evidence.
- After restarting only `aipg-audio-worker@gorgadon.service`, public model
  discovery advertised one `ace-step-v1.5-xl-turbo` audio worker.
- A fresh fifteen-minute session with the same account.read and
  inference.submit scopes called the deployed 0.3.0 remote MCP. A ten-second
  generation quoted at $0.002 completed in 17.87 seconds wall time (12.36
  seconds worker time) on `gorgadon-audio-3090`, returning a media resource link.
  The quote is not a separately verified ledger debit. The combined bounded
  canaries remain below the original $0.03 aggregate authorization.
- The returned WAV is readable PCM signed 16-bit, stereo, 48 kHz and exactly
  ten seconds, with mean volume -18.1 dB and peak -1.0 dB. This proves non-silent
  output and encoding, not a subjective musical-quality rating.

## Qualification Limits

- Real timed-keyframe and reference-audio/video generations were not run in
  this bounded canary. Contract tests cover forwarding; model discovery remains
  authoritative for recipe-specific support. Do not claim these combinations
  have all been production-qualified.

## Released Runtime Checks

- [Publication workflow](https://github.com/AIPowerGrid/grid-skill/actions/runs/38664695328)
  passed version/main ancestry checks, all 66 tests, build, audit and OIDC
  provenance publication. Registry metadata identifies the same package digest
  as the production build: SHA-1 `3389606d80663224ed005b89b2eec7c0bbdc68e2`.
- A fresh isolated registry installation initialized a real stdio MCP process,
  listed ten tools, discovered live LTX parameters, and recovered the completed
  canary video with its media resource link. `npm audit signatures` verified
  16 registry signatures and nine provenance attestations in the smoke install.
- Production independently passed those same read-only protocol checks.
- A second Google-backed authorization renewed the same two scopes for fifteen
  minutes. The deployed live verifier passed metadata, ten-tool discovery,
  credit inspection, quote, 20 concurrent same-token reads, immediate SSE
  headers (125 ms), and one tiny paid text call within the original aggregate
  $0.03 budget. No additional full canary budget was assumed.
- A 307,288-byte authenticated public tools/list request returned 200 with the
  new tool set, proving that the old proxy's 256 KiB rejection is gone without
  paying for another generation. The exact 67,174,400-byte ceiling and large
  request concurrency rejection are contract-tested, not production load-tested.
- The immutable production release passed all 66 tests and a zero-advisory
  audit on Node 22.22.0 before activation. The proxy configuration passed
  nginx validation; loopback health and the service are healthy after restart.
- Core, account settings, OAuth scopes, service credentials and the global
  charging gate were not changed in this release. The prior Core OAuth off/on
  drill was not repeated against unrelated live consumers; deployment retained
  the previous immutable MCP release and proxy backup for scoped rollback.
