// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";

import { GRID_ORIGIN, normalizeBaseUrl } from "./client.js";

const MAX_INTROSPECTION_BODY = 16_384;
const MAX_TOKEN_LENGTH = 4_200;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LIFETIME_SECONDS = 20 * 60;
const CLOCK_SKEW_SECONDS = 60;
const DEFAULT_POSITIVE_CACHE_MS = 5_000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_024;
const DEFAULT_MAX_PENDING_INTROSPECTIONS = 64;
const ALLOWED_SCOPES = new Set(["account.read", "inference.submit"]);

const CLIENT_ID_RE = /^grid_oauth_[A-Za-z0-9_-]{20,}$/;
const USER_TOKEN_RE = /^gridu_[A-Za-z0-9_-]{20,4000}\.[A-Za-z0-9_-]{20,100}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GridTokenVerifierOptions {
  serviceKey?: string;
  coreBaseUrl?: string;
  coreTransportUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => number;
  positiveCacheMs?: number;
  maxCacheEntries?: number;
  maxPendingIntrospections?: number;
}

interface CachedAuthInfo {
  auth: AuthInfo;
  validUntilMs: number;
}

function serverError(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.ServerError, message);
}

function invalidToken(message = "The access token is invalid or expired"): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

function serviceKey(value: string | undefined): string {
  const key = value ?? process.env.AIPG_MCP_SERVICE_KEY;
  if (!key || !/^grid_[A-Za-z0-9_-]{28,}$/.test(key)) {
    throw new Error("AIPG_MCP_SERVICE_KEY must be an introspection-only grid-mcp service key");
  }
  return key;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function tokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_INTROSPECTION_BODY) {
    throw serverError("Grid token introspection returned an oversized response");
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_INTROSPECTION_BODY) {
        await reader.cancel();
        throw serverError("Grid token introspection returned an oversized response");
      }
      chunks.push(value);
    }
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw serverError("Grid token introspection returned invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serverError("Grid token introspection returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") throw serverError("Grid token introspection omitted scopes");
  const scopes = value.split(" ").filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) throw invalidToken();
  if (scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) throw invalidToken();
  return scopes;
}

export class GridTokenVerifier implements OAuthTokenVerifier {
  private readonly key: string;
  private readonly coreBaseUrl: string;
  private readonly coreTransportUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly positiveCacheMs: number;
  private readonly maxCacheEntries: number;
  private readonly maxPendingIntrospections: number;
  private readonly positiveCache = new Map<string, CachedAuthInfo>();
  private readonly pendingIntrospections = new Map<string, Promise<AuthInfo>>();

  constructor(options: GridTokenVerifierOptions = {}) {
    this.key = serviceKey(options.serviceKey);
    this.coreBaseUrl = normalizeBaseUrl(options.coreBaseUrl ?? GRID_ORIGIN, "AIPG_MCP_CORE_BASE_URL");
    this.coreTransportUrl = normalizeBaseUrl(
      options.coreTransportUrl ?? this.coreBaseUrl,
      "AIPG_MCP_CORE_INTERNAL_URL",
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.positiveCacheMs = boundedInteger(
      options.positiveCacheMs ?? DEFAULT_POSITIVE_CACHE_MS,
      "positiveCacheMs",
      0,
      30_000,
    );
    this.maxCacheEntries = boundedInteger(
      options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
      "maxCacheEntries",
      1,
      10_000,
    );
    this.maxPendingIntrospections = boundedInteger(
      options.maxPendingIntrospections ?? DEFAULT_MAX_PENDING_INTROSPECTIONS,
      "maxPendingIntrospections",
      1,
      1_000,
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!USER_TOKEN_RE.test(token) || token.length > MAX_TOKEN_LENGTH) throw invalidToken();

    const cacheKey = tokenCacheKey(token);
    const nowMs = this.now();
    const cached = this.positiveCache.get(cacheKey);
    if (cached && cached.validUntilMs > nowMs) {
      // Touch the entry so insertion order remains a bounded LRU approximation.
      this.positiveCache.delete(cacheKey);
      this.positiveCache.set(cacheKey, cached);
      return cached.auth;
    }
    if (cached) this.positiveCache.delete(cacheKey);

    const pending = this.pendingIntrospections.get(cacheKey);
    if (pending) return pending;
    if (this.pendingIntrospections.size >= this.maxPendingIntrospections) {
      throw serverError("Grid token introspection is temporarily at capacity");
    }

    let verification: Promise<AuthInfo>;
    verification = this.introspectAccessToken(token)
      .then((auth) => {
        const lifetimeMs = typeof auth.expiresAt === "number"
          ? auth.expiresAt * 1_000 - this.now()
          : 0;
        const cacheMs = Math.min(this.positiveCacheMs, lifetimeMs);
        if (cacheMs > 0) {
          while (this.positiveCache.size >= this.maxCacheEntries) {
            const oldest = this.positiveCache.keys().next().value as string | undefined;
            if (!oldest) break;
            this.positiveCache.delete(oldest);
          }
          this.positiveCache.set(cacheKey, {
            auth,
            validUntilMs: this.now() + cacheMs,
          });
        }
        return auth;
      })
      .finally(() => {
        if (this.pendingIntrospections.get(cacheKey) === verification) {
          this.pendingIntrospections.delete(cacheKey);
        }
      });
    this.pendingIntrospections.set(cacheKey, verification);
    return verification;
  }

  private async introspectAccessToken(token: string): Promise<AuthInfo> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.coreTransportUrl}/v1/oauth/introspect`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (OAuthError.isInstance(error)) throw error;
      throw serverError("Grid token introspection is temporarily unavailable");
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw serverError("Grid token introspection is temporarily unavailable");
    }
    const value = await boundedJson(response);
    if (value.active !== true) throw invalidToken();

    const clientId = value.client_id;
    const subject = value.sub;
    const audience = value.aud;
    const issuer = value.iss;
    const tokenType = value.token_type;
    const issuedAt = value.iat;
    const expiresAt = value.exp;
    if (
      typeof clientId !== "string" || !CLIENT_ID_RE.test(clientId)
      || typeof subject !== "string" || !UUID_RE.test(subject)
      || audience !== this.coreBaseUrl
      || issuer !== this.coreBaseUrl
      || tokenType !== "Bearer"
      || !Number.isInteger(issuedAt)
      || !Number.isInteger(expiresAt)
    ) {
      throw invalidToken();
    }

    const nowSeconds = Math.floor(this.now() / 1_000);
    const iat = issuedAt as number;
    const exp = expiresAt as number;
    if (
      iat > nowSeconds + CLOCK_SKEW_SECONDS
      || exp <= nowSeconds
      || exp <= iat
      || exp - iat > MAX_TOKEN_LIFETIME_SECONDS
    ) {
      throw invalidToken();
    }

    return {
      token,
      clientId,
      scopes: parseScopes(value.scope),
      expiresAt: exp,
      resource: new URL(this.coreBaseUrl),
      extra: { sub: subject, iss: issuer },
    };
  }
}
