// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// Core permits 64 MiB of encoded sources plus a bounded JSON envelope.
export const GRID_MAX_REQUEST_BYTES = 64 * 1024 * 1024 + 64 * 1024;
export const GRID_MAX_VIDEO_FRAMES = 337;
const seed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const model = z.string().min(1).max(256);
const size = z.string().regex(/^\d+x\d+$/).max(32);
const sourceImage = z.string().min(1).max(17_000_000)
  .describe("Inline base64 image or image data URI; not a URL or local filename.");

export const quoteRequestSchema = z.object({
  model,
  modality: z.enum(["text", "image", "video", "audio", "3d"]),
  prompt_tokens: z.number().int().min(0).max(2_000_000).optional(),
  max_tokens: z.number().int().min(0).max(1_000_000).optional(),
  n: z.number().int().min(1).max(16).optional(),
  seconds: z.number().positive().max(3_600).optional(),
  frames: z.number().int().min(9).max(GRID_MAX_VIDEO_FRAMES).optional(),
}).strict();

export const textRequestSchema = z.object({
  prompt: z.string().min(1).max(200_000),
  model: model.optional(),
  system: z.string().max(100_000).optional(),
  max_tokens: z.number().int().min(1).max(1_000_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
}).strict();

export const imageRequestSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  model: model.optional(),
  n: z.number().int().min(1).max(4).optional(),
  size: size.optional(),
  seed: seed.optional(),
  negative_prompt: z.string().max(100_000).optional(),
  style: z.string().max(128).optional(),
  image: sourceImage.optional(),
  denoise: z.number().min(0).max(1).optional(),
  strength: z.number().min(0).max(1).optional(),
  steps: z.number().int().positive().optional(),
  cfg_scale: z.number().nonnegative().optional(),
  sampler: z.string().min(1).max(128).optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  max_cost_micro_usd: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

export const videoKeyframeSchema = z.object({
  image: sourceImage,
  frame: z.number().int().min(0).max(GRID_MAX_VIDEO_FRAMES - 1),
  strength: z.number().min(0).max(1).optional(),
}).strict();

export const videoRequestSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  model: model.optional(),
  n: z.number().int().min(1).max(2).optional(),
  seconds: z.number().positive().max(GRID_MAX_VIDEO_FRAMES / 24).optional(),
  frames: z.number().int().min(9).max(GRID_MAX_VIDEO_FRAMES).optional(),
  fps: z.number().int().min(8).max(30).optional(),
  size: size.optional(),
  seed: seed.optional(),
  image: sourceImage.optional(),
  reference_audio: z.string().min(1).max(16_777_280)
    .describe("Inline base64 or audio/wav data URI; exact source format/duration is checked by Core.").optional(),
  reference_video: z.string().min(1).max(44_739_308)
    .describe("Inline base64 or video/mp4 data URI; exact source format/duration is checked by Core.").optional(),
  reference_image: z.string().min(1).max(16_777_280)
    .describe("Inline base64 or image/png data URI for an appearance reference; Core checks dimensions.").optional(),
  keyframes: z.array(videoKeyframeSchema).max(16).optional(),
  style: z.string().max(128).optional(),
}).strict();

export const submitVideoRequestSchema = videoRequestSchema.extend({
  prompt: z.string().min(1).max(8_000),
  n: z.literal(1).optional(),
  negative_prompt: z.string().max(8_000).optional(),
  steps: z.number().int().min(4).max(40).optional(),
  cfg_scale: z.number().min(1).max(5).optional(),
  sampler: z.literal("euler_ancestral_cfg_pp").optional(),
  audio: z.boolean().optional(),
  guide_strength: z.number().positive().max(1).optional(),
  reference_strength: z.number().positive().max(1).optional(),
  reference_attention_strength: z.number().positive().max(1).optional(),
  motion_attention_strength: z.number().positive().max(1).optional(),
  max_cost_micro_usd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe("Required server-enforced spend ceiling in micro-USD (1000000 = $1). Quote first."),
  idempotency_key: z.uuid({ version: "v4" })
    .describe("Unique UUIDv4 request key. Reuse only to recover or retry this same submission."),
});

export const videoJobLookupSchema = z.object({
  job_id: z.uuid().optional(),
  idempotency_key: z.uuid({ version: "v4" }).optional(),
}).strict().refine((input) => Boolean(input.job_id) !== Boolean(input.idempotency_key), {
  message: "Specify exactly one job_id or idempotency_key",
});

export const audioRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  lyrics: z.string().max(20_000).optional(),
  model: z.string().min(1).max(128).optional(),
  seconds: z.number().min(10).max(300).optional(),
  inference_steps: z.number().int().min(1).max(20).optional(),
  bpm: z.number().int().min(30).max(300).optional(),
  key_scale: z.string().regex(/^[A-G](?:#|b)? (?:Major|minor)$/).optional(),
  time_signature: z.enum(["2/4", "3/4", "4/4", "6/8"]).optional(),
  vocal_language: z.string().regex(/^[a-z]{2}$/).optional(),
  seed: seed.optional(),
}).strict();

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type TextRequest = z.infer<typeof textRequestSchema>;
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export type VideoRequest = z.infer<typeof videoRequestSchema>;
export type AudioRequest = z.infer<typeof audioRequestSchema>;
export type SubmitVideoRequest = z.infer<typeof submitVideoRequestSchema>;
export type VideoJobLookup = z.infer<typeof videoJobLookupSchema>;
