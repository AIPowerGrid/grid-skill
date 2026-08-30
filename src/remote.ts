// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import { createMcpHandler, requireBearerAuth, type AuthInfo } from "@modelcontextprotocol/server";

import { GRID_ORIGIN, GridClient, normalizeBaseUrl } from "./client.js";
import { createGridMcpServer } from "./mcp.js";
import { GridTokenVerifier } from "./remote-auth.js";

export const MCP_PATH = "/v1/mcp";
export const MCP_MAX_REQUEST_BYTES = 256 * 1024;
export const MCP_SSE_KEEPALIVE_MS = 15_000;
export const MCP_REQUIRED_SCOPES = ["account.read", "inference.submit"] as const;

const DEFAULT_ALLOWED_HOSTNAMES = ["api.aipowergrid.io", "127.0.0.1", "localhost", "[::1]"];
const DEFAULT_ALLOWED_ORIGINS = ["api.aipowergrid.io", "console.aipowergrid.io", "127.0.0.1", "localhost", "[::1]"];

export interface RemoteMcpServerOptions {
  serviceKey?: string;
  coreBaseUrl?: string;
  coreTransportUrl?: string;
  fetch?: typeof globalThis.fetch;
  gridFetch?: typeof globalThis.fetch;
  introspectionTimeoutMs?: number;
  sseKeepAliveMs?: number;
  allowedHostnames?: string[];
  allowedOriginHostnames?: string[];
  onerror?: (error: Error) => void;
}

class HttpInputError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function jsonResponse(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(encoded),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(encoded);
}

async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  const body = Buffer.from(await response.arrayBuffer());
  // Authentication responses can contain token validity and scope state. Do
  // not let a proxy or user agent reuse them for a later request.
  headers["cache-control"] = "no-store";
  headers["content-length"] = String(body.byteLength);
  res.writeHead(response.status, headers);
  res.end(body);
}

function authenticationRequest(req: IncomingMessage, coreBaseUrl: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(`${coreBaseUrl}${req.url ?? MCP_PATH}`, { method: req.method ?? "GET", headers });
}

function contentLength(req: IncomingMessage): number | undefined {
  const raw = req.headers["content-length"];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) || !/^\d+$/.test(raw)) throw new HttpInputError(400, "Invalid Content-Length");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new HttpInputError(400, "Invalid Content-Length");
  return value;
}

async function readBoundedJson(req: IncomingMessage): Promise<unknown> {
  const mediaType = (req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw new HttpInputError(415, "Content-Type must be application/json");
  const declared = contentLength(req);
  if (declared !== undefined && declared > MCP_MAX_REQUEST_BYTES) {
    throw new HttpInputError(413, "MCP request body is too large");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    received += value.byteLength;
    if (received > MCP_MAX_REQUEST_BYTES) throw new HttpInputError(413, "MCP request body is too large");
    chunks.push(value);
  }
  if (received === 0) throw new HttpInputError(400, "MCP request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpInputError(400, "MCP request body must be valid JSON");
  }
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/invalid";
  }
}

function requireAuthInfo(authInfo: AuthInfo | undefined): AuthInfo {
  if (!authInfo) throw new Error("Remote MCP request reached the handler without verified authorization");
  return authInfo;
}

export function createRemoteMcpHttpServer(options: RemoteMcpServerOptions = {}): Server {
  const coreBaseUrl = normalizeBaseUrl(options.coreBaseUrl ?? GRID_ORIGIN, "AIPG_MCP_CORE_BASE_URL");
  const coreTransportUrl = normalizeBaseUrl(
    options.coreTransportUrl ?? coreBaseUrl,
    "AIPG_MCP_CORE_INTERNAL_URL",
  );
  const sseKeepAliveMs = options.sseKeepAliveMs ?? MCP_SSE_KEEPALIVE_MS;
  if (!Number.isInteger(sseKeepAliveMs) || sseKeepAliveMs < 1 || sseKeepAliveMs > 60_000) {
    throw new Error("sseKeepAliveMs must be an integer from 1 through 60000");
  }
  const verifierOptions = {
    ...(options.serviceKey === undefined ? {} : { serviceKey: options.serviceKey }),
    coreBaseUrl,
    coreTransportUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.introspectionTimeoutMs === undefined ? {} : { timeoutMs: options.introspectionTimeoutMs }),
  };
  const verifier = new GridTokenVerifier(verifierOptions);
  const resourceMetadataUrl = `${coreBaseUrl}/.well-known/oauth-protected-resource`;
  const authenticate = requireBearerAuth({
    verifier,
    requiredScopes: [...MCP_REQUIRED_SCOPES],
    resourceMetadataUrl,
  });
  const report = options.onerror ?? ((error: Error) => console.error(`aipg-mcp-http: ${error.message}`));
  const mcp = createMcpHandler((context) => {
    const auth = requireAuthInfo(context.authInfo);
    return createGridMcpServer(new GridClient({
      accessToken: auth.token,
      baseUrl: coreTransportUrl,
      ...(options.gridFetch === undefined && options.fetch === undefined
        ? {}
        : { fetch: options.gridFetch ?? options.fetch }),
    }));
  }, {
    onerror: report,
    responseMode: "sse",
    keepAliveMs: sseKeepAliveMs,
  });

  const nodeHandler = toNodeHandler(mcp, { onerror: report });
  const validateHost = hostHeaderValidation(options.allowedHostnames ?? DEFAULT_ALLOWED_HOSTNAMES);
  const validateOrigin = originValidation(options.allowedOriginHostnames ?? DEFAULT_ALLOWED_ORIGINS);

  const server = createServer(async (req, res) => {
    try {
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;
      const path = requestPath(req);
      if (path === "/healthz") {
        if (req.method !== "GET") {
          res.writeHead(405, { Allow: "GET" });
          res.end();
          return;
        }
        jsonResponse(res, 200, { status: "ok" });
        return;
      }
      if (path !== MCP_PATH) {
        jsonResponse(res, 404, { error: "not_found" });
        return;
      }

      const auth = await authenticate(authenticationRequest(req, coreBaseUrl));
      if (auth instanceof Response) {
        await writeFetchResponse(res, auth);
        return;
      }
      (req as IncomingMessage & { auth?: AuthInfo }).auth = auth;
      const parsedBody = req.method === "POST" ? await readBoundedJson(req) : undefined;
      await nodeHandler(req as unknown as NodeIncomingMessageLike, res, parsedBody);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpInputError) {
        jsonResponse(res, error.status, { error: "invalid_request", error_description: error.message });
        return;
      }
      report(error instanceof Error ? error : new Error(String(error)));
      jsonResponse(res, 500, { error: "server_error" });
    }
  });

  server.on("close", () => void mcp.close().catch(report));
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
