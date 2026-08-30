// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { verifyDarkDeployment } from "../deploy/verify-dark.mjs";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function send(response: ServerResponse, status: number, body = "") {
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json",
  });
  response.end(body);
}

interface Overrides {
  localBody?: string;
  publicHealthStatus?: number;
  mcpStatus?: number;
  cacheControl?: string;
  metadataUrl?: string;
  discoveryStatus?: number;
  registrationStatus?: number;
}

async function environment(overrides: Overrides = {}) {
  const localUrl = await listen((request, response) => {
    if (request.url !== "/healthz") return send(response, 404);
    send(response, 200, overrides.localBody ?? '{"status":"ok"}');
  });

  let publicOrigin = "";
  publicOrigin = await listen((request, response) => {
    if (request.url === "/healthz") {
      return send(response, overrides.publicHealthStatus ?? 404);
    }
    if (request.url === "/v1/mcp") {
      response.setHeader("Cache-Control", overrides.cacheControl ?? "private, no-store");
      response.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${overrides.metadataUrl ?? `${publicOrigin}/.well-known/oauth-protected-resource`}"`,
      );
      return send(response, overrides.mcpStatus ?? 401);
    }
    if (
      request.url === "/.well-known/oauth-protected-resource"
      || request.url === "/.well-known/oauth-authorization-server"
    ) {
      return send(response, overrides.discoveryStatus ?? 404);
    }
    if (request.url === "/v1/oauth/register") {
      return send(response, overrides.registrationStatus ?? 404);
    }
    send(response, 500);
  });
  return { localUrl, publicOrigin };
}

describe("remote MCP dark deployment preflight", () => {
  it("proves private health, the public challenge, and disabled OAuth routes", async () => {
    const targets = await environment();
    await expect(verifyDarkDeployment(targets)).resolves.toEqual({
      status: "ready_dark",
      local_health: "private_ready",
      public_mcp: "auth_challenge_ready",
      oauth: "disabled",
    });
  });

  it.each([
    [{ localBody: '{"status":"starting"}' }, /exact ready payload/],
    [{ publicHealthStatus: 200 }, /Public MCP health returned 200/],
    [{ mcpStatus: 404 }, /Unauthenticated public MCP route returned 404/],
    [{ cacheControl: "private" }, /omitted Cache-Control/],
    [{ metadataUrl: "https://evil.example/metadata" }, /invalid OAuth challenge/],
    [{ discoveryStatus: 200 }, /Dark OAuth route .* returned 200/],
    [{ registrationStatus: 201 }, /Dark OAuth registration route returned 201/],
  ] as const)("fails closed when the dark rollout contract drifts", async (overrides, error) => {
    const targets = await environment(overrides);
    await expect(verifyDarkDeployment(targets)).rejects.toThrow(error);
  });

  it("rejects a non-loopback health target before making requests", async () => {
    await expect(verifyDarkDeployment({
      localUrl: "https://example.com",
      publicOrigin: "https://api.aipowergrid.io",
    })).rejects.toThrow(/Local MCP URL/);
  });
});
