// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer, type CallToolResult, type ResourceLink } from "@modelcontextprotocol/server";
import { z } from "zod";

import { GridClient, extractMediaUrls, type JsonObject } from "./client.js";

const VERSION = "0.1.0";

function result(value: JsonObject, includeUrls = false): CallToolResult {
  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(value, null, 2) },
  ];
  if (includeUrls) {
    for (const [index, url] of extractMediaUrls(value).entries()) {
      const link: ResourceLink = {
        type: "resource_link",
        name: `aipg-output-${index + 1}`,
        title: `AI Power Grid output ${index + 1}`,
        uri: url,
        description: "Shareable generated media URL",
      };
      content.push(link);
    }
  }
  return { content, structuredContent: value };
}

function toolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function createGridMcpServer(client = new GridClient()): McpServer {
  const server = new McpServer(
    { name: "aipowergrid", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "aipg_list_models",
    {
      title: "List AI Power Grid models",
      description: "List live text and media model availability and performance.",
      inputSchema: z.object({}),
      annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try { return result(await client.listModels()); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_get_credits",
    {
      title: "Get Grid credits",
      description: "Read the current account's promotional, free, paid, and total spendable credits.",
      inputSchema: z.object({}),
      annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try { return result(await client.getCredits()); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_quote",
    {
      title: "Quote a Grid request",
      description: "Quote a text, image, video, audio, or 3D request without moving credits.",
      inputSchema: z.object({
        model: z.string().min(1).max(256),
        modality: z.enum(["text", "image", "video", "audio", "3d"]),
        prompt_tokens: z.number().int().min(0).max(2_000_000).optional(),
        max_tokens: z.number().int().min(0).max(1_000_000).optional(),
        n: z.number().int().min(1).max(16).optional(),
        seconds: z.number().positive().max(3_600).optional(),
      }),
      annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try { return result(await client.quote(input)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_text",
    {
      title: "Generate text",
      description: "Run a non-streaming chat completion on AI Power Grid.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(200_000),
        model: z.string().min(1).max(256).optional(),
        system: z.string().max(100_000).optional(),
        max_tokens: z.number().int().min(1).max(1_000_000).optional(),
        temperature: z.number().min(0).max(2).optional(),
      }),
      annotations,
    },
    async (input) => {
      try { return result(await client.generateText(input)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_image",
    {
      title: "Generate an image",
      description: "Generate one or more images and return shareable HTTPS media URLs.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(100_000),
        model: z.string().min(1).max(256).optional(),
        n: z.number().int().min(1).max(4).optional(),
        size: z.string().regex(/^\d+x\d+$/).optional(),
        seed: z.number().int().nonnegative().optional(),
        negative_prompt: z.string().max(100_000).optional(),
        style: z.string().max(128).optional(),
      }),
      annotations,
    },
    async (input) => {
      try { return result(await client.generateImage(input), true); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_video",
    {
      title: "Generate a video",
      description: "Generate a video from text, optionally with a start image, and return shareable HTTPS URLs.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(100_000),
        model: z.string().min(1).max(256).optional(),
        seconds: z.number().min(1).max(10).optional(),
        fps: z.number().int().min(8).max(30).optional(),
        size: z.string().regex(/^\d+x\d+$/).optional(),
        seed: z.number().int().nonnegative().optional(),
        image: z.string().max(20_000_000).optional(),
        style: z.string().max(128).optional(),
      }),
      annotations,
    },
    async (input) => {
      try { return result(await client.generateVideo(input), true); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_audio",
    {
      title: "Generate music or audio",
      description: "Generate audio with ACE-Step controls and return shareable HTTPS URLs.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(2_000),
        lyrics: z.string().max(20_000).optional(),
        model: z.string().min(1).max(128).optional(),
        seconds: z.number().min(10).max(300).optional(),
        inference_steps: z.number().int().min(1).max(20).optional(),
        bpm: z.number().int().min(30).max(300).optional(),
        key_scale: z.string().min(7).max(12).optional(),
        time_signature: z.enum(["2/4", "3/4", "4/4", "6/8"]).optional(),
        vocal_language: z.string().regex(/^[a-zA-Z]{2}$/).optional(),
        seed: z.number().int().nonnegative().optional(),
      }),
      annotations,
    },
    async (input) => {
      try { return result(await client.generateAudio(input), true); } catch (error) { return toolError(error); }
    },
  );

  return server;
}
