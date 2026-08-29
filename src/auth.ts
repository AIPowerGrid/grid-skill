// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import { GRID_ORIGIN, normalizeBaseUrl } from "./client.js";

const CLIENT_FILE = "oauth-client.json";
const SESSION_FILE = "session.json";
const REGISTERED_REDIRECT_URI = "http://127.0.0.1/oauth/callback";
const OAUTH_SCOPES = ["account.read", "inference.submit"] as const;
const MAX_RESPONSE_BODY = 16_384;
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60_000;
const MAX_NETWORK_TIMEOUT_MS = 30_000;

interface StoredClient {
  issuer: string;
  client_id: string;
  redirect_uri: string;
}

export interface OAuthSession {
  issuer: string;
  resource: string;
  access_token: string;
  token_type: "Bearer";
  scope: string;
  expires_at: string;
}

export interface OAuthLoginOptions {
  baseUrl?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  openBrowser?: boolean;
  openUrl?: (url: string) => Promise<boolean>;
  onAuthorize?: (url: string, opened: boolean) => void;
}

export interface GridCredential {
  token: string;
  source: "api_key" | "environment_token" | "oauth_session";
  expiresAt?: string;
}

function configDirectory(override?: string): string {
  return override ?? process.env.AIPG_CONFIG_DIR ?? join(homedir(), ".config", "aipg");
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function singleParam(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function isValidClient(value: unknown, issuer: string): value is StoredClient {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.issuer === issuer
    && typeof item.client_id === "string"
    && /^grid_oauth_[A-Za-z0-9_-]{20,}$/.test(item.client_id)
    && item.redirect_uri === REGISTERED_REDIRECT_URI;
}

function isValidSession(value: unknown, issuer: string): value is OAuthSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const scope = typeof item.scope === "string" ? item.scope : "";
  const scopeValues = scope.split(" ").filter(Boolean);
  return item.issuer === issuer
    && item.resource === issuer
    && item.token_type === "Bearer"
    && typeof item.access_token === "string"
    && /^gridu_[A-Za-z0-9_-]{20,4000}\.[A-Za-z0-9_-]{20,100}$/.test(item.access_token)
    && scopeValues.length === OAUTH_SCOPES.length
    && OAUTH_SCOPES.every((required) => scopeValues.includes(required))
    && typeof item.expires_at === "string"
    && Number.isFinite(Date.parse(item.expires_at));
}

async function readJson(path: string): Promise<unknown> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > MAX_RESPONSE_BODY) return undefined;
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.${base64Url(randomBytes(8))}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function readBoundedJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BODY) {
    throw new Error(`${label} returned an oversized response`);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BODY) {
        await reader.cancel();
        throw new Error(`${label} returned an oversized response`);
      }
      chunks.push(value);
    }
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  if (!response.ok) {
    const item = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    const detail = typeof item.error_description === "string"
      ? item.error_description
      : typeof item.detail === "string" ? item.detail : `HTTP ${response.status}`;
    if (response.status === 404) {
      throw new Error("Grid browser authorization is not enabled yet; use GRID_API_KEY until the rollout is live");
    }
    throw new Error(`${label} failed: ${detail.slice(0, 500)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} returned invalid JSON`);
  return parsed as Record<string, unknown>;
}

async function registerClient(
  issuer: string,
  directory: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<StoredClient> {
  const path = join(directory, CLIENT_FILE);
  const existing = await readJson(path);
  if (isValidClient(existing, issuer)) return existing;

  const response = await fetchImpl(`${issuer}/v1/oauth/register`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REGISTERED_REDIRECT_URI],
      client_name: "AI Power Grid CLI and MCP",
      application_type: "native",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readBoundedJson(response, "Grid OAuth registration");
  const client: StoredClient = {
    issuer,
    client_id: String(body.client_id ?? ""),
    redirect_uri: REGISTERED_REDIRECT_URI,
  };
  if (!isValidClient(client, issuer)) throw new Error("Grid OAuth registration returned invalid client metadata");
  await writePrivateJson(path, client);
  return client;
}

async function verifyAuthorizationServer(
  issuer: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<void> {
  const response = await fetchImpl(`${issuer}/.well-known/oauth-authorization-server`, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readBoundedJson(response, "Grid OAuth discovery");
  const exactValues: Record<string, string> = {
    issuer,
    authorization_endpoint: `${issuer}/v1/oauth/authorize`,
    token_endpoint: `${issuer}/v1/oauth/token`,
    registration_endpoint: `${issuer}/v1/oauth/register`,
  };
  for (const [name, expected] of Object.entries(exactValues)) {
    if (body[name] !== expected) throw new Error(`Grid OAuth discovery returned an invalid ${name}`);
  }
  const challengeMethods = Array.isArray(body.code_challenge_methods_supported)
    ? body.code_challenge_methods_supported
    : [];
  const scopes = Array.isArray(body.scopes_supported) ? body.scopes_supported : [];
  if (!challengeMethods.includes("S256") || !OAUTH_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new Error("Grid OAuth discovery does not advertise the required PKCE method and scopes");
  }
}

async function defaultOpenUrl(url: string): Promise<boolean> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

function waitForCallback(
  state: string,
  issuer: string,
  timeoutMs: number,
): Promise<{ code: string; redirectUri: string }> & { port: Promise<number>; close: () => void } {
  let closeServer = () => {};
  let resolvePort: (port: number) => void;
  let rejectPort: (error: Error) => void;
  const port = new Promise<number>((resolve, reject) => {
    resolvePort = resolve;
    rejectPort = reject;
  });

  const callback = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: { code: string; redirectUri: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      response.setHeader("X-Content-Type-Options", "nosniff");
      if (request.method !== "GET" || !request.url) {
        response.writeHead(404).end("Not found");
        return;
      }
      const callbackUrl = new URL(request.url, "http://127.0.0.1");
      const address = server.address();
      const expectedHost = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
      if (request.headers.host !== expectedHost) {
        response.writeHead(400).end("Invalid callback host. Return to the terminal.");
        return;
      }
      if (callbackUrl.pathname !== "/oauth/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      const returnedState = singleParam(callbackUrl.searchParams, "state");
      const returnedIssuer = singleParam(callbackUrl.searchParams, "iss");
      const code = singleParam(callbackUrl.searchParams, "code");
      const oauthError = singleParam(callbackUrl.searchParams, "error");
      if (returnedState !== state || returnedIssuer !== issuer) {
        response.writeHead(400).end("Authorization response validation failed. Return to the terminal.");
        finish(new Error("Grid authorization callback failed state or issuer validation"));
        return;
      }
      if (oauthError) {
        const description = singleParam(callbackUrl.searchParams, "error_description") ?? oauthError;
        response.writeHead(400).end("Authorization was not granted. Return to the terminal.");
        finish(new Error(`Grid authorization failed: ${description.slice(0, 500)}`));
        return;
      }
      if (!code || !/^oauth_code_[A-Za-z0-9_-]{20,}$/.test(code)) {
        response.writeHead(400).end("Authorization code was missing. Return to the terminal.");
        finish(new Error("Grid authorization callback did not contain a valid code"));
        return;
      }
      if (!address || typeof address === "string") {
        response.writeHead(500).end("Local callback failed. Return to the terminal.");
        finish(new Error("Could not determine the local authorization callback address"));
        return;
      }
      response.writeHead(200).end("AI Power Grid authorization complete. You can close this tab.");
      finish(undefined, { code, redirectUri: `http://127.0.0.1:${address.port}/oauth/callback` });
    });
    const timer = setTimeout(() => finish(new Error("Grid authorization timed out")), timeoutMs);
    server.once("error", (error) => {
      rejectPort(error);
      finish(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        const error = new Error("Could not bind the local authorization callback");
        rejectPort(error);
        finish(error);
        return;
      }
      resolvePort(address.port);
    });
    closeServer = () => finish(new Error("Grid authorization was cancelled"));
  }) as Promise<{ code: string; redirectUri: string }> & { port: Promise<number>; close: () => void };
  callback.port = port;
  callback.close = () => closeServer();
  return callback;
}

export async function oauthLogin(options: OAuthLoginOptions = {}): Promise<OAuthSession> {
  const issuer = normalizeBaseUrl(options.baseUrl ?? process.env.GRID_BASE_URL ?? GRID_ORIGIN);
  const directory = configDirectory(options.configDir);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const networkTimeoutMs = Math.min(timeoutMs, MAX_NETWORK_TIMEOUT_MS);
  await verifyAuthorizationServer(issuer, fetchImpl, networkTimeoutMs);
  const client = await registerClient(issuer, directory, fetchImpl, networkTimeoutMs);
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(32));
  const callback = waitForCallback(state, issuer, timeoutMs);

  try {
    const port = await callback.port;
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const authorize = new URL(`${issuer}/v1/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: issuer,
    }).toString();
    const openUrl = options.openUrl ?? defaultOpenUrl;
    const opened = options.openBrowser === false ? false : await openUrl(authorize.toString());
    options.onAuthorize?.(authorize.toString(), opened);

    const authorization = await callback;
    const tokenResponse = await fetchImpl(`${issuer}/v1/oauth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorization.code,
        client_id: client.client_id,
        redirect_uri: authorization.redirectUri,
        code_verifier: verifier,
        resource: issuer,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(networkTimeoutMs),
    });
    const body = await readBoundedJson(tokenResponse, "Grid OAuth token exchange");
    const expiresIn = Number(body.expires_in);
    const session: OAuthSession = {
      issuer,
      resource: issuer,
      access_token: String(body.access_token ?? ""),
      token_type: "Bearer",
      scope: String(body.scope ?? ""),
      expires_at: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    };
    if (body.token_type !== "Bearer"
      || !Number.isInteger(expiresIn)
      || expiresIn < 60
      || expiresIn > 3_600
      || !isValidSession(session, issuer)) {
      throw new Error("Grid OAuth token exchange returned an invalid or over-broad token response");
    }
    await writePrivateJson(join(directory, SESSION_FILE), session);
    return session;
  } finally {
    callback.close();
  }
}

export async function loadOAuthSession(options: { baseUrl?: string; configDir?: string } = {}): Promise<OAuthSession | undefined> {
  const issuer = normalizeBaseUrl(options.baseUrl ?? process.env.GRID_BASE_URL ?? GRID_ORIGIN);
  const value = await readJson(join(configDirectory(options.configDir), SESSION_FILE));
  if (!isValidSession(value, issuer)) return undefined;
  if (Date.parse(value.expires_at) <= Date.now() + 5_000) return undefined;
  return value;
}

export async function resolveGridCredential(options: { baseUrl?: string; configDir?: string } = {}): Promise<GridCredential | undefined> {
  if (process.env.GRID_API_KEY) return { token: process.env.GRID_API_KEY, source: "api_key" };
  if (process.env.GRID_ACCESS_TOKEN) return { token: process.env.GRID_ACCESS_TOKEN, source: "environment_token" };
  const session = await loadOAuthSession(options);
  if (!session) return undefined;
  return { token: session.access_token, source: "oauth_session", expiresAt: session.expires_at };
}

export async function logoutOAuth(options: { configDir?: string } = {}): Promise<boolean> {
  try {
    await rm(join(configDirectory(options.configDir), SESSION_FILE));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
