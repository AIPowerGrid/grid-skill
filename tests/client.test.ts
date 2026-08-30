// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import {
  GRID_REQUEST_TIMEOUTS_MS,
  GridApiError,
  GridClient,
  extractMediaUrls,
} from "../src/client.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GridClient", () => {
  it("keeps discovery public and combines text and media models", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "auto" }] }))
      .mockResolvedValueOnce(jsonResponse({ image: [{ model: "Krea 2 Turbo" }] }));
    const client = new GridClient({
      apiKey: "grid_should_not_be_sent",
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual({
      text: { data: [{ id: "auto" }] },
      media: { image: [{ model: "Krea 2 Turbo" }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers).not.toHaveProperty("Authorization");
      expect(init.redirect).toBe("error");
    }
  });

  it("authenticates and sends the exact quote contract", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ estimated_cost_usd: "0.01" }));
    const client = new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://localhost:9999",
      fetch: fetchMock,
    });

    await client.quote({ model: "LTX-2.3", modality: "video", seconds: 4 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:9999/v1/account/credits/quote");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer grid_test_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      model: "LTX-2.3",
      modality: "video",
      seconds: 4,
    });
  });

  it("accepts a short-lived OAuth bearer token without treating it as an API-key argument", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ total_usd: "1.00" }));
    const client = new GridClient({
      accessToken: "test_short_lived_user_token",
      baseUrl: "http://localhost:9999",
      fetch: fetchMock,
    });

    await client.getCredits();
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test_short_lived_user_token",
    });
  });

  it("forces URL output for media and extracts only HTTPS links", async () => {
    const payload = {
      data: [
        { url: "https://media.aipg.art/image/one.webp" },
        { url: "javascript:alert(1)" },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    const client = new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
    });

    const response = await client.generateImage({ prompt: "a clean cube" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "a clean cube", response_format: "url" });
    expect(extractMediaUrls(response)).toEqual(["https://media.aipg.art/image/one.webp"]);
  });

  it("uses Core-aligned deadlines with headroom for every generation modality", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ data: [] }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const client = new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
    });

    await client.generateText({ prompt: "hello" });
    await client.generateImage({ prompt: "a cube" });
    await client.generateVideo({ prompt: "a moving cube" });
    await client.generateAudio({ prompt: "a short motif" });

    expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      GRID_REQUEST_TIMEOUTS_MS.text,
      GRID_REQUEST_TIMEOUTS_MS.image,
      GRID_REQUEST_TIMEOUTS_MS.video,
      GRID_REQUEST_TIMEOUTS_MS.audio,
    ]);
    timeout.mockRestore();
  });

  it("keeps timeoutMs as an explicit all-request override", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const client = new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
      timeoutMs: 1_234,
    });

    await client.generateAudio({ prompt: "a short motif" });
    expect(timeout).toHaveBeenLastCalledWith(1_234);
    timeout.mockRestore();
  });

  it("never leaks a key through API or transport errors", async () => {
    const secret = "grid_super_secret_value";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: `bad ${secret}` }, 401));
    const client = new GridClient({
      apiKey: secret,
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
    });

    await expect(client.getCredits()).rejects.toThrow("[REDACTED]");
    try {
      await client.getCredits();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(error).toBeInstanceOf(GridApiError);
    }
  });

  it("rejects arbitrary alternate API origins", () => {
    expect(() => new GridClient({ baseUrl: "https://attacker.example" })).toThrow("must be");
    expect(() => new GridClient({ baseUrl: "ftp://localhost/core" })).toThrow("HTTP or HTTPS");
  });
});
