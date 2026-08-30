// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRemoteMcpHttpServer, MCP_MAX_REQUEST_BYTES } from "../src/remote.js";

const CORE_ISSUER = "http://127.0.0.1:9999";
const CORE_TRANSPORT = "http://127.0.0.1:7010";
const SERVICE_KEY = `grid_${"s".repeat(32)}`;
const USER_TOKEN = `gridu_${"u".repeat(80)}.${"v".repeat(43)}`;
const NOW_SECONDS = Math.floor(Date.now() / 1_000);

const servers: Server[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function introspection(scopes = "account.read inference.submit"): Record<string, unknown> {
  return {
    active: true,
    client_id: `grid_oauth_${"c".repeat(32)}`,
    sub: "123e4567-e89b-42d3-a456-426614174000",
    aud: CORE_ISSUER,
    scope: scopes,
    token_type: "Bearer",
    iss: CORE_ISSUER,
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 890,
  };
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function serverWith(
  introspectionValue: Record<string, unknown> = introspection(),
  gridFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ total_usd: "1.00" }))),
  sseKeepAliveMs = 15_000,
): { server: Server; introspectFetch: ReturnType<typeof vi.fn<typeof fetch>>; gridFetch: typeof gridFetch } {
  const introspectFetch = vi.fn<typeof fetch>().mockImplementation(
    async () => new Response(JSON.stringify(introspectionValue)),
  );
  return {
    server: createRemoteMcpHttpServer({
      serviceKey: SERVICE_KEY,
      coreBaseUrl: CORE_ISSUER,
      coreTransportUrl: CORE_TRANSPORT,
      fetch: introspectFetch,
      gridFetch,
      sseKeepAliveMs,
      onerror: () => undefined,
    }),
    introspectFetch,
    gridFetch,
  };
}

describe("remote Grid MCP server", () => {
  it("serves MCP over HTTP and forwards only the verified user token to Grid", async () => {
    const gridFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ total_usd: "1.00" })));
    const running = serverWith(introspection(), gridFetch);
    const origin = await listen(running.server);
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/v1/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${USER_TOKEN}` } },
    });
    const client = new Client({ name: "remote-mcp-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("aipg_get_credits");
    const result = await client.callTool({ name: "aipg_get_credits", arguments: {} });
    expect(result.structuredContent).toEqual({ total_usd: "1.00" });

    expect(running.introspectFetch).toHaveBeenCalled();
    for (const [url, init] of running.introspectFetch.mock.calls) {
      expect(String(url)).toBe(`${CORE_TRANSPORT}/v1/oauth/introspect`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${SERVICE_KEY}`);
      expect(String(init?.body)).toBe(`token=${USER_TOKEN}`);
    }
    expect(gridFetch).toHaveBeenCalledWith(`${CORE_TRANSPORT}/v1/account/credits`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${USER_TOKEN}` }),
    }));
    expect(JSON.stringify(gridFetch.mock.calls)).not.toContain(SERVICE_KEY);
  });

  it("advertises protected-resource metadata when authorization is missing", async () => {
    const running = serverWith();
    const origin = await listen(running.server);
    const response = await fetch(`${origin}/v1/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${CORE_ISSUER}/.well-known/oauth-protected-resource"`,
    );
    expect(running.introspectFetch).not.toHaveBeenCalled();
  });

  it("returns insufficient_scope when either required scope is absent", async () => {
    const running = serverWith(introspection("account.read"));
    const origin = await listen(running.server);
    const response = await fetch(`${origin}/v1/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${USER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(response.headers.get("www-authenticate")).toContain("inference.submit");
  });

  it("rejects oversized bodies, hostile origins, and unrelated paths before MCP handling", async () => {
    const running = serverWith();
    const origin = await listen(running.server);
    const headers = {
      Authorization: `Bearer ${USER_TOKEN}`,
      "Content-Type": "application/json",
    };

    const oversized = await fetch(`${origin}/v1/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ value: "x".repeat(MCP_MAX_REQUEST_BYTES) }),
    });
    expect(oversized.status).toBe(413);

    const hostileOrigin = await fetch(`${origin}/v1/mcp`, {
      method: "POST",
      headers: { ...headers, Origin: "https://attacker.example" },
      body: "{}",
    });
    expect(hostileOrigin.status).toBe(403);

    const missing = await fetch(`${origin}/not-mcp`, { headers: { Origin: "https://console.aipowergrid.io" } });
    expect(missing.status).toBe(404);
  });

  it("exposes a minimal unauthenticated loopback health check", async () => {
    const running = serverWith();
    const origin = await listen(running.server);
    const response = await fetch(`${origin}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("starts an SSE response before a long Grid tool call completes", async () => {
    let resolveGrid!: (response: Response) => void;
    const gridFetch = vi.fn<typeof fetch>().mockImplementation(
      async () => new Promise<Response>((resolve) => { resolveGrid = resolve; }),
    );
    const running = serverWith(introspection(), gridFetch, 25);
    const origin = await listen(running.server);

    let resolveObserved!: (contentType: string | null) => void;
    const observed = new Promise<string | null>((resolve) => { resolveObserved = resolve; });
    const transportFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = request.method === "POST" ? await request.clone().text() : "";
      const response = await fetch(input, init);
      if (body.includes("aipg_get_credits")) resolveObserved(response.headers.get("content-type"));
      return response;
    };
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/v1/mcp`), {
      fetch: transportFetch,
      requestInit: { headers: { Authorization: `Bearer ${USER_TOKEN}` } },
    });
    const client = new Client({ name: "remote-mcp-sse-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(transport);

    const call = client.callTool({ name: "aipg_get_credits", arguments: {} });
    const contentType = await Promise.race([
      observed,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("SSE headers were buffered")), 2_000)),
    ]);
    expect(contentType).toContain("text/event-stream");

    resolveGrid(new Response(JSON.stringify({ total_usd: "1.00" })));
    await expect(call).resolves.toMatchObject({ structuredContent: { total_usd: "1.00" } });
  });
});
