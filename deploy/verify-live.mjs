#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pathToFileURL } from "node:url";

const DEFAULT_PUBLIC_ORIGIN = "https://api.aipowergrid.io";
const DEFAULT_MODEL = "gpt-oss-120b";
const MAX_APPROVED_SPEND_USD = 0.03;
const SAME_TOKEN_CONCURRENCY = 20;
const REQUIRED_TOOLS = new Set([
  "aipg_list_models",
  "aipg_get_credits",
  "aipg_quote",
  "aipg_generate_text",
  "aipg_generate_image",
  "aipg_generate_video",
  "aipg_generate_audio",
]);
const USER_TOKEN_RE = /^gridu_[A-Za-z0-9_-]{20,4000}\.[A-Za-z0-9_-]{20,100}$/;

function publicOrigin(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/"
  ) {
    throw new Error("AIPG_MCP_CANARY_ORIGIN must be an HTTPS origin");
  }
  return parsed.origin;
}

function requiredToken(value) {
  if (!value || !USER_TOKEN_RE.test(value)) {
    throw new Error("AIPG_MCP_ACCESS_TOKEN must be a short-lived Grid user token");
  }
  return value;
}

async function requireMetadata(origin, fetchImpl) {
  const response = await fetchImpl(`${origin}/.well-known/oauth-authorization-server`, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`OAuth discovery returned ${response.status}`);
  const metadata = await response.json();
  if (
    metadata.issuer !== origin
    || metadata.authorization_endpoint !== `${origin}/v1/oauth/authorize`
    || metadata.token_endpoint !== `${origin}/v1/oauth/token`
    || metadata.registration_endpoint !== `${origin}/v1/oauth/register`
    || !metadata.code_challenge_methods_supported?.includes("S256")
  ) {
    throw new Error("OAuth discovery did not match the reviewed production contract");
  }
}

function requireToolSuccess(result, label) {
  if (result?.isError === true || !result?.structuredContent) {
    throw new Error(`${label} did not return structured success content`);
  }
  return result.structuredContent;
}

function quotedCost(value) {
  const candidate = value?.estimate?.cost_usd;
  const cost = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Grid quote omitted a valid estimate.cost_usd");
  }
  return cost;
}

export async function verifyLiveDeployment({
  origin = process.env.AIPG_MCP_CANARY_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN,
  accessToken = process.env.AIPG_MCP_ACCESS_TOKEN,
  model = process.env.AIPG_MCP_CANARY_MODEL ?? DEFAULT_MODEL,
  paidText = process.env.AIPG_MCP_CANARY_PAID_TEXT === "1",
  fetchImpl = globalThis.fetch,
} = {}) {
  const publicApi = publicOrigin(origin);
  const token = requiredToken(accessToken);
  await requireMetadata(publicApi, fetchImpl);

  let firstToolHeadersMs;
  const observedFetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = request.method === "POST" ? await request.clone().text() : "";
    const started = Date.now();
    const response = await fetchImpl(input, init);
    if (firstToolHeadersMs === undefined && body.includes('"method":"tools/call"')) {
      firstToolHeadersMs = Date.now() - started;
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        throw new Error("Remote MCP tool call did not start an SSE response");
      }
    }
    return response;
  };

  const transport = new StreamableHTTPClientTransport(new URL(`${publicApi}/v1/mcp`), {
    fetch: observedFetch,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "aipg-supervised-canary", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of REQUIRED_TOOLS) {
      if (!names.has(name)) throw new Error(`Remote MCP omitted required tool ${name}`);
    }

    requireToolSuccess(
      await client.callTool({ name: "aipg_get_credits", arguments: {} }),
      "Credit inspection",
    );
    const quote = requireToolSuccess(
      await client.callTool({
        name: "aipg_quote",
        arguments: { model, modality: "text", prompt_tokens: 16, max_tokens: 16 },
      }),
      "Text quote",
    );
    const costUsd = quotedCost(quote);
    if (costUsd > MAX_APPROVED_SPEND_USD) {
      throw new Error(`Quoted text canary exceeds the $${MAX_APPROVED_SPEND_USD.toFixed(2)} cap`);
    }

    await Promise.all(
      Array.from({ length: SAME_TOKEN_CONCURRENCY }, () => client.listTools()),
    );

    if (paidText) {
      requireToolSuccess(
        await client.callTool({
          name: "aipg_generate_text",
          arguments: {
            model,
            prompt: "Reply with exactly: MCP canary",
            max_tokens: 16,
            temperature: 0,
          },
        }),
        "Paid text canary",
      );
    }

    return {
      status: "ready_live",
      oauth: "authorized",
      tools: names.size,
      credit_read: "passed",
      quote: "passed",
      same_token_requests: SAME_TOKEN_CONCURRENCY,
      sse_headers_ms: firstToolHeadersMs,
      paid_text: paidText ? "passed" : "skipped",
    };
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyLiveDeployment()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(`remote MCP live canary failed: ${error.message}`);
      process.exitCode = 1;
    });
}
