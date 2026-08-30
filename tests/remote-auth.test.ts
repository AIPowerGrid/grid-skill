// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { OAuthErrorCode } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { GridTokenVerifier, type GridTokenVerifierOptions } from "../src/remote-auth.js";

const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1_000);
const CORE_ISSUER = "http://127.0.0.1:9999";
const CORE_TRANSPORT = "http://127.0.0.1:7010";
const SERVICE_KEY = `grid_${"s".repeat(32)}`;
const USER_TOKEN = `gridu_${"u".repeat(80)}.${"v".repeat(43)}`;

function active(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    active: true,
    client_id: `grid_oauth_${"c".repeat(32)}`,
    sub: "123e4567-e89b-42d3-a456-426614174000",
    aud: CORE_ISSUER,
    scope: "account.read inference.submit",
    token_type: "Bearer",
    iss: CORE_ISSUER,
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 890,
    ...overrides,
  };
}

function verifier(fetchImpl: typeof fetch, options: Partial<GridTokenVerifierOptions> = {}): GridTokenVerifier {
  return new GridTokenVerifier({
    serviceKey: SERVICE_KEY,
    coreBaseUrl: CORE_ISSUER,
    coreTransportUrl: CORE_TRANSPORT,
    fetch: fetchImpl,
    now: () => NOW_MS,
    ...options,
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
    expect(result.resource?.toString()).toBe(`${CORE_ISSUER}/`);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${CORE_TRANSPORT}/v1/oauth/introspect`);
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

  it("bounds repeated valid-token introspection with a short positive cache", async () => {
    let nowMs = NOW_MS;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () => new Response(JSON.stringify(active())),
    );
    const tokenVerifier = verifier(fetchMock, {
      now: () => nowMs,
      positiveCacheMs: 5_000,
    });

    await tokenVerifier.verifyAccessToken(USER_TOKEN);
    await tokenVerifier.verifyAccessToken(USER_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowMs += 5_001;
    await tokenVerifier.verifyAccessToken(USER_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent checks for one token into one Core request", async () => {
    let resolveIntrospection!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () => new Promise<Response>((resolve) => { resolveIntrospection = resolve; }),
    );
    const tokenVerifier = verifier(fetchMock);

    const first = tokenVerifier.verifyAccessToken(USER_TOKEN);
    const second = tokenVerifier.verifyAccessToken(USER_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveIntrospection(new Response(JSON.stringify(active())));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed before unbounded distinct introspection work accumulates", async () => {
    let resolveIntrospection!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () => new Promise<Response>((resolve) => { resolveIntrospection = resolve; }),
    );
    const tokenVerifier = verifier(fetchMock, { maxPendingIntrospections: 1 });
    const otherToken = `gridu_${"w".repeat(80)}.${"x".repeat(43)}`;

    const first = tokenVerifier.verifyAccessToken(USER_TOKEN);
    await expect(tokenVerifier.verifyAccessToken(otherToken)).rejects.toMatchObject({
      code: OAuthErrorCode.ServerError,
      message: expect.stringContaining("at capacity"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveIntrospection(new Response(JSON.stringify(active())));
    await expect(first).resolves.toMatchObject({ token: USER_TOKEN });
  });
});
