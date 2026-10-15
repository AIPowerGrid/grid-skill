// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer, type CallToolResult, type ResourceLink } from "@modelcontextprotocol/server";
import { z } from "zod";

import { GridClient, extractMediaUrls, type JsonObject } from "./client.js";
import {
  audioRequestSchema, imageRequestSchema, quoteRequestSchema, textRequestSchema, videoRequestSchema,
  submitVideoRequestSchema, videoJobLookupSchema,
} from "./requests.js";

const VERSION = "0.3.0";

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

const paidGenerationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
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
      annotations: readOnlyAnnotations,
    },
    async () => {
      try { return result(await client.listModels()); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_get_model_parameters",
    {
      title: "Get model parameters",
      description: "Read the live model-specific media contract: supported source modes, frame alignment, dimensions, sampler, steps, audio setting and other limits. Check this before using advanced image or video controls; availability alone does not prove parameter support.",
      inputSchema: z.object({ model: z.string().min(1).max(256) }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ model }) => {
      try { return result(await client.getModelParameters(model)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_get_credits",
    {
      title: "Get Grid credits",
      description: "Read the current account's promotional, free, paid, and total spendable credits.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
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
      inputSchema: quoteRequestSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try { return result(await client.quote(input)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_text",
    {
      title: "Generate text",
      description: "Run a paid non-streaming chat completion on AI Power Grid. This consumes Grid credits; quote first when a budget or confirmation is required.",
      inputSchema: textRequestSchema,
      annotations: paidGenerationAnnotations,
    },
    async (input) => {
      try { return result(await client.generateText(input)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_image",
    {
      title: "Generate an image",
      description: "Generate or edit paid images and return shareable HTTPS media URLs. Supply an inline image only for a model advertising img2img. Model-specific steps, cfg_scale and sampler are validated by Core. This consumes Grid credits; quote first when a budget or confirmation is required.",
      inputSchema: imageRequestSchema,
      annotations: paidGenerationAnnotations,
    },
    async (input) => {
      try { return result(await client.generateImage(input), true); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_video",
    {
      title: "Generate a video",
      description: "Generate paid video with a start image, timed keyframes, or supported reference audio/video/image inputs. Discover a model's source modes first; Core validates recipe-specific frame counts, source formats and combinations. Inline sources share a 64 MiB encoded-media budget. This consumes Grid credits; quote first when a budget or confirmation is required.",
      inputSchema: videoRequestSchema,
      annotations: paidGenerationAnnotations,
    },
    async (input) => {
      try { return result(await client.generateVideo(input), true); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_submit_video_job",
    {
      title: "Submit a video job",
      description: "Submit paid LTX video generation with a required server-enforced spend ceiling and unique idempotency key. Use this for current LTX models, keyframes and reference media. Returns a job to poll with aipg_get_video_job. After a timeout, look up the same key before retrying; never submit a new key automatically. This consumes Grid credits; quote first when a budget or confirmation is required.",
      inputSchema: submitVideoRequestSchema,
      annotations: { ...paidGenerationAnnotations, idempotentHint: true },
    },
    async (input) => {
      try { return result(await client.submitVideo(input), true); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_get_video_job",
    {
      title: "Get a video job",
      description: "Read status and output URLs for your video job, or recover a lost submission reply by its idempotency key. Does not submit another job or spend credits. Poll with a delay rather than a tight loop.",
      inputSchema: videoJobLookupSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try { return result(await client.getVideoJob(input), true); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "aipg_generate_audio",
    {
      title: "Generate music or audio",
      description: "Generate paid audio with ACE-Step controls and return shareable HTTPS URLs. This consumes Grid credits; quote first when a budget or confirmation is required.",
      inputSchema: audioRequestSchema,
      annotations: paidGenerationAnnotations,
    },
    async (input) => {
      try { return result(await client.generateAudio(input), true); } catch (error) { return toolError(error); }
    },
  );

  return server;
}
