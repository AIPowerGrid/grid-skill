#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { GridClient, type JsonObject, type Modality } from "./client.js";
import { createGridMcpServer } from "./mcp.js";

type Flags = Record<string, string | boolean>;

function parseArgs(args: string[]): { command: string | undefined; flags: Flags } {
  const [command, ...rest] = args;
  const flags: Flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) throw new Error(`Unexpected argument: ${token ?? ""}`);
    const name = token.slice(2).replaceAll("-", "_");
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = value;
      index += 1;
    }
  }
  return { command, flags };
}

function stringFlag(flags: Flags, name: string, required = false): string | undefined {
  const value = flags[name];
  if (required && typeof value !== "string") throw new Error(`--${name.replaceAll("_", "-")} is required`);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(flags: Flags, name: string): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name.replaceAll("_", "-")} must be a number`);
  return value;
}

function clean(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function help(): void {
  console.log(`AI Power Grid CLI

Usage:
  aipg models
  aipg credits
  aipg quote --model MODEL --modality text|image|video|audio|3d [--seconds N] [--max-tokens N]
  aipg text --prompt TEXT [--model MODEL] [--max-tokens N] [--system TEXT]
  aipg image --prompt TEXT [--model MODEL] [--size 1024x1024] [--n N]
  aipg video --prompt TEXT [--model MODEL] [--seconds N] [--fps N] [--size 768x512]
  aipg audio --prompt TEXT [--lyrics TEXT] [--model MODEL] [--seconds N] [--bpm N]
  aipg mcp

Set GRID_API_KEY in your environment. Never pass credentials as command arguments.`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flags.help) return help();
  if (command === "mcp") {
    serveStdio(() => createGridMcpServer(), { onerror: (error) => console.error(`aipg-mcp: ${error.message}`) });
    return;
  }

  const client = new GridClient();
  let output: JsonObject;
  switch (command) {
    case "models":
      output = await client.listModels();
      break;
    case "credits":
      output = await client.getCredits();
      break;
    case "quote": {
      const modality = stringFlag(flags, "modality", true) as Modality;
      if (!["text", "image", "video", "audio", "3d"].includes(modality)) throw new Error("--modality is invalid");
      output = await client.quote(clean({
        model: stringFlag(flags, "model", true), modality,
        prompt_tokens: numberFlag(flags, "prompt_tokens"), max_tokens: numberFlag(flags, "max_tokens"),
        n: numberFlag(flags, "n"), seconds: numberFlag(flags, "seconds"),
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
      }) as unknown as Parameters<GridClient["generateImage"]>[0]);
      break;
    case "video":
      output = await client.generateVideo(clean({
        prompt: stringFlag(flags, "prompt", true), model: stringFlag(flags, "model"),
        seconds: numberFlag(flags, "seconds"), fps: numberFlag(flags, "fps"), size: stringFlag(flags, "size"),
        seed: numberFlag(flags, "seed"), image: stringFlag(flags, "image"), style: stringFlag(flags, "style"),
      }) as unknown as Parameters<GridClient["generateVideo"]>[0]);
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
      throw new Error(`Unknown command: ${command}`);
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
