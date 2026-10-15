#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { logoutOAuth, oauthLogin, resolveGridCredential } from "./auth.js";
import {
  parseCliArgs,
  type CliFlags,
  validateCliInvocation,
} from "./cli-options.js";
import { GridClient, type JsonObject, type Modality } from "./client.js";
import { createGridMcpServer } from "./mcp.js";
import { inlineMediaFile, keyframesFile } from "./cli-media.js";

function stringFlag(flags: CliFlags, name: string, required = false): string | undefined {
  const value = flags[name];
  if (required && typeof value !== "string") throw new Error(`--${name.replaceAll("_", "-")} is required`);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(flags: CliFlags, name: string): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name.replaceAll("_", "-")} must be a number`);
  return value;
}

function booleanValueFlag(flags: CliFlags, name: string): boolean | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false") throw new Error(`--${name.replaceAll("_", "-")} must be true or false`);
  return value === "true";
}

async function videoFields(flags: CliFlags): Promise<JsonObject> {
  return clean({
    prompt: stringFlag(flags, "prompt", true), model: stringFlag(flags, "model"),
    seconds: numberFlag(flags, "seconds"), fps: numberFlag(flags, "fps"), size: stringFlag(flags, "size"),
    seed: numberFlag(flags, "seed"), image: await imageFlag(flags), style: stringFlag(flags, "style"),
    n: numberFlag(flags, "n"), frames: numberFlag(flags, "frames"),
    reference_audio: await referenceFile(flags, "reference_audio_file", "audio"),
    reference_video: await referenceFile(flags, "reference_video_file", "video"),
    reference_image: await referenceFile(flags, "reference_image_file", "image"),
    keyframes: flags.keyframes_file ? await keyframesFile(stringFlag(flags, "keyframes_file", true)!) : undefined,
  });
}

function clean(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function imageFlag(flags: CliFlags): Promise<string | undefined> {
  if (flags.image !== undefined && flags.image_file !== undefined) throw new Error("Use --image or --image-file, not both");
  const path = stringFlag(flags, "image_file");
  return path ? inlineMediaFile(path) : stringFlag(flags, "image");
}

async function referenceFile(flags: CliFlags, name: string, role: "image" | "audio" | "video"): Promise<string | undefined> {
  const path = stringFlag(flags, name);
  return path ? inlineMediaFile(path, role) : undefined;
}

function help(): void {
  console.log(`AI Power Grid CLI

Usage:
  aipg models
  aipg params --model MODEL
  aipg login [--no-open]
  aipg logout
  aipg auth-status
  aipg credits
  aipg quote --model MODEL --modality text|image|video|audio|3d [--seconds N] [--max-tokens N]
  aipg text --prompt TEXT [--model MODEL] [--max-tokens N] [--system TEXT]
  aipg image --prompt TEXT [--model MODEL] [--size 1024x1024] [--n N]
  aipg image --prompt TEXT --image-file source.png [--model MODEL]
  aipg video --prompt TEXT [--model MODEL] [--frames N | --seconds N] [--fps N]
             [--image-file source.png] [--keyframes-file pins.json]
             [--reference-audio-file source.wav | --reference-video-file source.mp4]
             [--reference-image-file appearance.png]
  aipg audio --prompt TEXT [--lyrics TEXT] [--model MODEL] [--seconds N] [--bpm N]
  aipg video-submit --prompt TEXT --max-cost-micro-usd N --idempotency-key KEY
                    [--frames N] [--image-file source.png] [--audio true|false]
  aipg video-status --job-id UUID | --idempotency-key KEY
  aipg mcp

Run \`aipg login\` for short-lived browser authorization, or set GRID_API_KEY.
Never pass credentials as command arguments.`);
}

async function authenticatedClient(): Promise<GridClient> {
  const credential = await resolveGridCredential();
  if (!credential) return new GridClient();
  return credential.source === "api_key"
    ? new GridClient({ apiKey: credential.token })
    : new GridClient({ accessToken: credential.token });
}

async function main(): Promise<void> {
  const { command, flags } = parseCliArgs(process.argv.slice(2));
  validateCliInvocation(command, flags);
  if (!command || command === "help" || flags.help) return help();
  if (command === "login") {
    const session = await oauthLogin({
      openBrowser: flags.no_open !== true,
      onAuthorize(url, opened) {
        console.log(opened ? "Opened Grid authorization in your browser." : "Open this Grid authorization URL:");
        console.log(url);
      },
    });
    console.log(`Authorized through ${session.expires_at} with scopes: ${session.scope}`);
    return;
  }
  if (command === "logout") {
    console.log(await logoutOAuth() ? "Removed the local Grid OAuth session." : "No local Grid OAuth session was stored.");
    return;
  }
  if (command === "auth-status") {
    const credential = await resolveGridCredential();
    if (!credential) {
      console.log("Not authenticated. Run `aipg login` or set GRID_API_KEY.");
      return;
    }
    const suffix = credential.expiresAt ? ` until ${credential.expiresAt}` : "";
    console.log(`Authenticated via ${credential.source}${suffix}.`);
    return;
  }
  if (command === "mcp") {
    const client = await authenticatedClient();
    serveStdio(() => createGridMcpServer(client), { onerror: (error) => console.error(`aipg-mcp: ${error.message}`) });
    return;
  }

  const client = await authenticatedClient();
  let output: JsonObject;
  switch (command) {
    case "models":
      output = await client.listModels();
      break;
    case "credits":
      output = await client.getCredits();
      break;
    case "params":
      output = await client.getModelParameters(stringFlag(flags, "model", true)!);
      break;
    case "quote": {
      const modality = stringFlag(flags, "modality", true) as Modality;
      if (!["text", "image", "video", "audio", "3d"].includes(modality)) throw new Error("--modality is invalid");
      output = await client.quote(clean({
        model: stringFlag(flags, "model", true), modality,
        prompt_tokens: numberFlag(flags, "prompt_tokens"), max_tokens: numberFlag(flags, "max_tokens"),
        n: numberFlag(flags, "n"), seconds: numberFlag(flags, "seconds"), frames: numberFlag(flags, "frames"),
      }) as unknown as Parameters<GridClient["quote"]>[0]);
      break;
    }
    case "text":
      output = await client.generateText(clean({
        prompt: stringFlag(flags, "prompt", true), model: stringFlag(flags, "model"),
        system: stringFlag(flags, "system"), max_tokens: numberFlag(flags, "max_tokens"),
        temperature: numberFlag(flags, "temperature"),
      }) as unknown as Parameters<GridClient["generateText"]>[0]);
      break;
    case "image":
      output = await client.generateImage(clean({
        prompt: stringFlag(flags, "prompt", true), model: stringFlag(flags, "model"),
        n: numberFlag(flags, "n"), size: stringFlag(flags, "size"), seed: numberFlag(flags, "seed"),
        negative_prompt: stringFlag(flags, "negative_prompt"), style: stringFlag(flags, "style"),
        image: await imageFlag(flags), steps: numberFlag(flags, "steps"), cfg_scale: numberFlag(flags, "cfg_scale"),
        denoise: numberFlag(flags, "denoise"), strength: numberFlag(flags, "strength"),
        sampler: stringFlag(flags, "sampler"), output_format: stringFlag(flags, "output_format"),
        max_cost_micro_usd: numberFlag(flags, "max_cost_micro_usd"),
      }) as unknown as Parameters<GridClient["generateImage"]>[0]);
      break;
    case "video":
      output = await client.generateVideo(await videoFields(flags) as unknown as Parameters<GridClient["generateVideo"]>[0]);
      break;
    case "video-submit":
      output = await client.submitVideo(clean({
        ...await videoFields(flags),
        max_cost_micro_usd: numberFlag(flags, "max_cost_micro_usd"),
        idempotency_key: stringFlag(flags, "idempotency_key", true),
        negative_prompt: stringFlag(flags, "negative_prompt"),
        steps: numberFlag(flags, "steps"), cfg_scale: numberFlag(flags, "cfg_scale"),
        sampler: stringFlag(flags, "sampler"), audio: booleanValueFlag(flags, "audio"),
        guide_strength: numberFlag(flags, "guide_strength"), reference_strength: numberFlag(flags, "reference_strength"),
        reference_attention_strength: numberFlag(flags, "reference_attention_strength"),
        motion_attention_strength: numberFlag(flags, "motion_attention_strength"),
      }) as unknown as Parameters<GridClient["submitVideo"]>[0]);
      break;
    case "video-status":
      output = await client.getVideoJob(clean({
        job_id: stringFlag(flags, "job_id"), idempotency_key: stringFlag(flags, "idempotency_key"),
      }));
      break;
    case "audio":
      output = await client.generateAudio(clean({
        prompt: stringFlag(flags, "prompt", true), lyrics: stringFlag(flags, "lyrics"), model: stringFlag(flags, "model"),
        seconds: numberFlag(flags, "seconds"), inference_steps: numberFlag(flags, "inference_steps"),
        bpm: numberFlag(flags, "bpm"), key_scale: stringFlag(flags, "key_scale"),
        time_signature: stringFlag(flags, "time_signature"), vocal_language: stringFlag(flags, "vocal_language"),
        seed: numberFlag(flags, "seed"),
      }) as unknown as Parameters<GridClient["generateAudio"]>[0]);
      break;
    default:
      throw new Error(`Unsupported command state: ${command}`);
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
