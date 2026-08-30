#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pathToFileURL } from "node:url";

const DEFAULT_LOCAL_URL = "http://127.0.0.1:8788";
const DEFAULT_PUBLIC_ORIGIN = "https://api.aipowergrid.io";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HEALTH_BODY_BYTES = 1_024;

function origin(value, label, { loopbackOnly = false } = {}) {
  const parsed = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/"
    || (loopbackOnly && (!loopback || parsed.protocol !== "http:"))
    || (!loopback && parsed.protocol !== "https:")
  ) {
    throw new Error(`${label} must be an HTTPS origin or an HTTP loopback origin`);
  }
  return parsed.origin;
}

async function request(fetchImpl, url, init = {}) {
  return fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function discard(response) {
  await response.body?.cancel();
}

function requireStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}; expected ${expected}`);
  }
}

function hasDirective(value, directive) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(directive);
}

async function exactHealth(response) {
  requireStatus(response, 200, "Loopback MCP health");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HEALTH_BODY_BYTES) {
    throw new Error("Loopback MCP health returned an oversized body");
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_HEALTH_BODY_BYTES || body !== '{"status":"ok"}') {
    throw new Error("Loopback MCP health did not return the exact ready payload");
  }
}

export async function verifyDarkDeployment({
  localUrl = DEFAULT_LOCAL_URL,
  publicOrigin = DEFAULT_PUBLIC_ORIGIN,
  fetchImpl = globalThis.fetch,
} = {}) {
  const local = origin(localUrl, "Local MCP URL", { loopbackOnly: true });
  const publicApi = origin(publicOrigin, "Public API origin");
  const metadataUrl = `${publicApi}/.well-known/oauth-protected-resource`;

  await exactHealth(await request(fetchImpl, `${local}/healthz`));

  const publicHealth = await request(fetchImpl, `${publicApi}/healthz`);
  requireStatus(publicHealth, 404, "Public MCP health");
  await discard(publicHealth);

  const mcp = await request(fetchImpl, `${publicApi}/v1/mcp`);
  requireStatus(mcp, 401, "Unauthenticated public MCP route");
  if (!hasDirective(mcp.headers.get("cache-control") ?? "", "no-store")) {
    throw new Error("Unauthenticated public MCP route omitted Cache-Control: no-store");
  }
  const challenge = mcp.headers.get("www-authenticate") ?? "";
  if (
    !/^Bearer(?:\s|$)/i.test(challenge)
    || !challenge.includes(`resource_metadata="${metadataUrl}"`)
  ) {
    throw new Error("Unauthenticated public MCP route returned an invalid OAuth challenge");
  }
  await discard(mcp);

  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ]) {
    const discovery = await request(fetchImpl, `${publicApi}${path}`);
    requireStatus(discovery, 404, `Dark OAuth route ${path}`);
    await discard(discovery);
  }

  const registration = await request(fetchImpl, `${publicApi}/v1/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["http://127.0.0.1/oauth/callback"],
      client_name: "AIPG dark rollout preflight",
      application_type: "native",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  requireStatus(registration, 404, "Dark OAuth registration route");
  await discard(registration);

  return {
    status: "ready_dark",
    local_health: "private_ready",
    public_mcp: "auth_challenge_ready",
    oauth: "disabled",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDarkDeployment({
    localUrl: process.env.AIPG_MCP_PREFLIGHT_LOCAL_URL ?? DEFAULT_LOCAL_URL,
    publicOrigin: process.env.AIPG_MCP_PREFLIGHT_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN,
  })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(`remote MCP dark preflight failed: ${error.message}`);
      process.exitCode = 1;
    });
}
