// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ZodType } from "zod";
import {
  GRID_MAX_REQUEST_BYTES,
  audioRequestSchema, imageRequestSchema, quoteRequestSchema, textRequestSchema, videoRequestSchema,
  submitVideoRequestSchema, videoJobLookupSchema,
  type AudioRequest, type ImageRequest, type QuoteRequest, type TextRequest, type VideoRequest,
  type SubmitVideoRequest, type VideoJobLookup,
} from "./requests.js";

export type { AudioRequest, ImageRequest, QuoteRequest, TextRequest, VideoRequest } from "./requests.js";
export type { SubmitVideoRequest, VideoJobLookup } from "./requests.js";

export const GRID_ORIGIN = "https://api.aipowergrid.io";

const MAX_ERROR_BODY = 2_000;
export const GRID_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export const GRID_REQUEST_TIMEOUTS_MS = {
  default: 30_000,
  text: 330_000,
  image: 330_000,
  video: 630_000,
  audio: 1_950_000,
} as const;

export type JsonObject = Record<string, unknown>;
export type Modality = "text" | "image" | "video" | "audio" | "3d";

export interface GridClientOptions {
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function normalizeBaseUrl(value: string | undefined, variableName = "GRID_BASE_URL"): string {
  const candidate = (value || GRID_ORIGIN).replace(/\/+$/, "");
  const parsed = new URL(candidate);
  const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if (candidate !== GRID_ORIGIN && !isLoopback) {
    throw new Error(`${variableName} must be ${GRID_ORIGIN} or a loopback URL`);
  }
  if (isLoopback && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${variableName} loopback URLs must use HTTP or HTTPS`);
  }
  if (candidate === GRID_ORIGIN && parsed.protocol !== "https:") {
    throw new Error("The production Grid API requires HTTPS");
  }
  return candidate;
}

function scrub(value: string, secret: string | undefined): string {
  return secret ? value.replaceAll(secret, "[REDACTED]") : value;
}

function omitUndefined<T extends object>(value: T): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function validate<T>(schema: ZodType<T>, input: T): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Validation errors must not reflect private inline media or prompt text.
    throw new GridApiError(`Invalid Grid request fields: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}

async function readBoundedText(response: Response, limit: number, label: string): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new GridApiError(`${label} exceeded the ${limit}-byte response limit`, response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new GridApiError(`${label} exceeded the ${limit}-byte response limit`, response.status);
    }
    chunks.push(value);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new GridApiError(`${label} returned invalid UTF-8`, response.status);
  }
}

export class GridApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GridApiError";
  }
}

export class GridClient {
  readonly baseUrl: string;
  private readonly credential: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number | undefined;

  constructor(options: GridClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.GRID_BASE_URL);
    this.credential = options.apiKey ?? options.accessToken ?? process.env.GRID_API_KEY ?? process.env.GRID_ACCESS_TOKEN;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async listModels(): Promise<JsonObject> {
    const [text, media] = await Promise.all([
      this.request<JsonObject>("GET", "/v1/models", undefined, false),
      this.request<JsonObject>("GET", "/v1/status/models", undefined, false),
    ]);
    return { text, media };
  }

  async getCredits(): Promise<JsonObject> {
    return this.request("GET", "/v1/account/credits");
  }

  async getModelParameters(model: string): Promise<JsonObject> {
    if (!model || model.length > 256) throw new GridApiError("Invalid model name");
    return this.request("GET", `/v1/models/${encodeURIComponent(model)}/params`, undefined, false);
  }

  async quote(input: QuoteRequest): Promise<JsonObject> {
    return this.request("POST", "/v1/account/credits/quote", omitUndefined(validate(quoteRequestSchema, input)));
  }

  async generateText(input: TextRequest): Promise<JsonObject> {
    input = validate(textRequestSchema, input);
    const messages: JsonObject[] = [];
    if (input.system) messages.push({ role: "system", content: input.system });
    messages.push({ role: "user", content: input.prompt });
    return this.request("POST", "/v1/chat/completions", omitUndefined({
      model: input.model ?? "auto",
      messages,
      max_tokens: input.max_tokens ?? 1_024,
      temperature: input.temperature,
      stream: false,
    }), true, GRID_REQUEST_TIMEOUTS_MS.text);
  }

  async generateImage(input: ImageRequest): Promise<JsonObject> {
    return this.request("POST", "/v1/images/generations", omitUndefined({
      ...validate(imageRequestSchema, input),
      response_format: "url",
    }), true, GRID_REQUEST_TIMEOUTS_MS.image);
  }

  async generateVideo(input: VideoRequest): Promise<JsonObject> {
    return this.request("POST", "/v1/videos/generations", omitUndefined({
      ...validate(videoRequestSchema, input),
      response_format: "url",
    }), true, GRID_REQUEST_TIMEOUTS_MS.video);
  }

  async generateAudio(input: AudioRequest): Promise<JsonObject> {
    return this.request("POST", "/v1/audio/generations", omitUndefined(validate(audioRequestSchema, input)), true, GRID_REQUEST_TIMEOUTS_MS.audio);
  }

  async submitVideo(input: SubmitVideoRequest): Promise<JsonObject> {
    const { idempotency_key, ...body } = validate(submitVideoRequestSchema, input);
    return this.request("POST", "/v1/videos/jobs", { ...omitUndefined(body), response_format: "url" },
      true, GRID_REQUEST_TIMEOUTS_MS.video, { "Idempotency-Key": idempotency_key });
  }

  async getVideoJob(input: VideoJobLookup): Promise<JsonObject> {
    const lookup = validate(videoJobLookupSchema, input);
    return this.request("GET", lookup.job_id ? `/v1/videos/jobs/${lookup.job_id}` : "/v1/videos/jobs",
      undefined, true, GRID_REQUEST_TIMEOUTS_MS.default,
      lookup.idempotency_key ? { "Idempotency-Key": lookup.idempotency_key } : {});
  }

  private async request<T extends JsonObject>(
    method: "GET" | "POST",
    path: string,
    body?: JsonObject,
    authenticated = true,
    timeoutMs: number = GRID_REQUEST_TIMEOUTS_MS.default,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    if (authenticated && !this.credential) {
      throw new GridApiError(
        "Authentication is required. Run `aipg login` or set GRID_API_KEY from https://console.aipowergrid.io/dashboard/api-key.",
      );
    }

    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (body) headers["Content-Type"] = "application/json";
    if (authenticated && this.credential) headers.Authorization = `Bearer ${this.credential}`;

    try {
      const init: RequestInit = {
        method,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs ?? timeoutMs),
      };
      if (body) {
        init.body = JSON.stringify(body);
        if (Buffer.byteLength(init.body) > GRID_MAX_REQUEST_BYTES) {
          throw new GridApiError(`Grid request exceeded the ${GRID_MAX_REQUEST_BYTES}-byte body limit`);
        }
      }
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      if (!response.ok) {
        const detail = scrub(await readBoundedText(response, MAX_ERROR_BODY, "Grid API error body"), this.credential);
        throw new GridApiError(`Grid API ${response.status} on ${path}${detail ? `: ${detail}` : ""}`, response.status);
      }
      const text = await readBoundedText(response, GRID_MAX_RESPONSE_BYTES, "Grid API response");
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new GridApiError(`Grid API returned invalid JSON on ${path}`, response.status);
      }
    } catch (error) {
      if (error instanceof GridApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new GridApiError(scrub(`Grid API request failed on ${path}: ${message}`, this.credential));
    }
  }
}

export function extractMediaUrls(value: JsonObject): string[] {
  const nested = value.schema === "aipg.video-job.v1" && value.result && typeof value.result === "object"
    ? value.result as JsonObject : value;
  const data = value.schema === "aipg.video-job.v1" ? nested.media : nested.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const url = (item as JsonObject).url;
    return typeof url === "string" && /^https:\/\//.test(url) ? [url] : [];
  });
}
