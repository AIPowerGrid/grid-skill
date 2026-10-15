# Changelog

## 0.3.0 - 2026-10-14

- Add image editing, model-gated image controls, and bounded CLI media files.
- Add live model-parameter discovery for recipe-specific media constraints.
- Add video frames, timed keyframes and reference audio/video/image controls.
- Add credit-backed asynchronous video submission and read-only recovery with
  UUIDv4 idempotency keys, explicit spend ceilings and media resource links.
- Align remote and proxy request limits with Core's bounded video envelope;
  limit concurrent large requests while preserving small status reads.
- Share request validation across MCP and CLI, including safe seeds and audio
  control formats; keep browser login guidance aligned with the live release.
- Update MCP server/client to 2.3.1, Node adapter to 2.1.1 and vulnerable
  compatible transitive dependencies. The release dependency audit is clean.
