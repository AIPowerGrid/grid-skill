// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { OAuthErrorCode } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { GridTokenVerifier } from "../src/remote-auth.js";

const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1_000);
const CORE = "http://127.0.0.1:9999";
const SERVICE_KEY = `grid_${"s".repeat(32)}`;
const USER_TOKEN = `gridu_${"u".repeat(80)}.${"v".repeat(43)}`;

function active(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    active: true,
    client_id: `grid_oauth_${"c".repeat(32)}`,
    sub: "123e4567-e89b-42d3-a456-426614174000",
    aud: CORE,
    scope: "account.read inference.submit",
    token_type: "Bearer",
    iss: CORE,
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 890,
    ...overrides,
  };
}

function verifier(fetchImpl: typeof fetch): GridTokenVerifier {
  return new GridTokenVerifier({
    serviceKey: SERVICE_KEY,
    coreBaseUrl: CORE,
    fetch: fetchImpl,
    now: () => NOW_MS,
  });
}

describe("Grid OAuth token introspection", () => {
  it("returns bounded MCP auth info and never substitutes the service credential", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(active()), {
      headers: { "Content-Type": "application/json" },
    }));
    const result = await verifier(fetchMock).verifyAccessToken(USER_TOKEN);

    expect(result).toMatchObject({
      token: USER_TOKEN,
      clientId: `grid_oauth_${"c".repeat(32)}`,
      scopes: ["account.read", "inference.submit"],
      expiresAt: NOW_SECONDS + 890,
    });
    expect(result.resource?.toString()).toBe(`${CORE}/`);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${CORE}/v1/oauth/introspect`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${SERVICE_KEY}`);
    expect(String(init?.body)).toBe(`token=${USER_TOKEN}`);
    expect(init?.redirect).toBe("error");
  });

  it.each([
    ["inactive", { active: false }],
    ["wrong audience", { aud: "https://attacker.example" }],
    ["wrong issuer", { iss: "https://attacker.example" }],
    ["expired", { exp: NOW_SECONDS - 1 }],
    ["overlong lifetime", { iat: NOW_SECONDS - 10, exp: NOW_SECONDS + 1_300 }],
    ["unknown scope", { scope: "account.read root" }],
    ["invalid subject", { sub: "not-an-account" }],
  ])("rejects %s introspection output as an invalid token", async (_label, override) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(active(override))));
    await expect(verifier(fetchMock).verifyAccessToken(USER_TOKEN)).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
    });
  });

  it("maps an introspection outage to a server error instead of a false invalid-token answer", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(verifier(fetchMock).verifyAccessToken(USER_TOKEN)).rejects.toMatchObject({
      code: OAuthErrorCode.ServerError,
    });
  });

  it("rejects oversized introspection responses without exposing their body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("x", {
      headers: { "Content-Length": "20000" },
    }));
    await expect(verifier(fetchMock).verifyAccessToken(USER_TOKEN)).rejects.toMatchObject({
      code: OAuthErrorCode.ServerError,
      message: expect.not.stringContaining("x"),
    });
  });

  it("rejects malformed user tokens before contacting Core", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(verifier(fetchMock).verifyAccessToken("grid_not_a_user_token")).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
