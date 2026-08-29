// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOAuthSession, logoutOAuth, oauthLogin } from "../src/auth.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aipg-auth-test-"));
  directories.push(directory);
  return directory;
}

function oauthFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      const issuer = new URL(url).origin;
      return new Response(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/v1/oauth/authorize`,
        token_endpoint: `${issuer}/v1/oauth/token`,
        registration_endpoint: `${issuer}/v1/oauth/register`,
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["account.read", "inference.submit"],
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/v1/oauth/register")) {
      return new Response(JSON.stringify({ client_id: `grid_oauth_${"a".repeat(32)}` }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/v1/oauth/token")) {
      const form = init?.body as URLSearchParams;
      expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
      expect(form.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
      return new Response(JSON.stringify({
        access_token: `gridu_${"b".repeat(80)}.${"d".repeat(43)}`,
        token_type: "Bearer",
        expires_in: 900,
        scope: "account.read inference.submit",
      }), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected OAuth request: ${url}`);
  });
}

describe("native OAuth", () => {
  it("uses PKCE, validates the callback, and stores only a private short-lived session", async () => {
    const directory = await temporaryDirectory();
    const issuer = "http://127.0.0.1:9999";
    const fetchMock = oauthFetch();
    const session = await oauthLogin({
      baseUrl: issuer,
      configDir: directory,
      fetch: fetchMock,
      timeoutMs: 2_000,
      openUrl: async (url) => {
        const authorize = new URL(url);
        expect(authorize.origin).toBe(issuer);
        expect(authorize.pathname).toBe("/v1/oauth/authorize");
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorize.searchParams.get("resource")).toBe(issuer);
        const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
        callback.search = new URLSearchParams({
          code: `oauth_code_${"c".repeat(48)}`,
          state: authorize.searchParams.get("state") ?? "",
          iss: issuer,
        }).toString();
        void globalThis.fetch(callback);
        return true;
      },
    });

    expect(session.access_token).toMatch(/^gridu_/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(loadOAuthSession({ baseUrl: issuer, configDir: directory })).resolves.toEqual(session);
    const stored = JSON.parse(await readFile(join(directory, "session.json"), "utf8")) as Record<string, unknown>;
    expect(stored).not.toHaveProperty("refresh_token");
    expect(stored).not.toHaveProperty("code_verifier");
    if (process.platform !== "win32") {
      expect((await stat(join(directory, "session.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects an authorization response from the wrong issuer", async () => {
    const directory = await temporaryDirectory();
    const issuer = "http://127.0.0.1:9999";
    await expect(oauthLogin({
      baseUrl: issuer,
      configDir: directory,
      fetch: oauthFetch(),
      timeoutMs: 2_000,
      openUrl: async (url) => {
        const authorize = new URL(url);
        const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
        callback.search = new URLSearchParams({
          code: `oauth_code_${"c".repeat(48)}`,
          state: authorize.searchParams.get("state") ?? "",
          iss: "https://attacker.example",
        }).toString();
        void globalThis.fetch(callback);
        return true;
      },
    })).rejects.toThrow("state or issuer");
  });

  it("removes only the short-lived session on logout", async () => {
    const directory = await temporaryDirectory();
    await expect(logoutOAuth({ configDir: directory })).resolves.toBe(false);
  });
});
