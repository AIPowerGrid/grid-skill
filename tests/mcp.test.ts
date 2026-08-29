// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GridClient } from "../src/client.js";
import { createGridMcpServer } from "../src/mcp.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

async function connectedClient(grid: GridClient): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createGridMcpServer(grid);
  const client = new Client({ name: "grid-skill-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(() => client.close(), () => server.close());
  return client;
}

describe("Grid MCP server", () => {
  it("advertises the complete V1 tool surface", async () => {
    const grid = new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://127.0.0.1:9999",
      fetch: vi.fn<typeof fetch>(),
    });
    const client = await connectedClient(grid);
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "aipg_generate_audio",
      "aipg_generate_image",
      "aipg_generate_text",
      "aipg_generate_video",
      "aipg_get_credits",
      "aipg_list_models",
      "aipg_quote",
    ]);
  });

  it("returns structured output plus shareable media resource links", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: "https://media.aipg.art/audio/demo.wav", seed: 7 }],
    }), { status: 200 }));
    const client = await connectedClient(new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
    }));

    const output = await client.callTool({
      name: "aipg_generate_audio",
      arguments: { prompt: "instrumental post-rock", seconds: 20 },
    });
    expect(output.isError).not.toBe(true);
    expect(output.structuredContent).toEqual({
      data: [{ url: "https://media.aipg.art/audio/demo.wav", seed: 7 }],
    });
    expect(output.content).toContainEqual(expect.objectContaining({
      type: "resource_link",
      uri: "https://media.aipg.art/audio/demo.wav",
    }));
  });

  it("returns bounded tool errors instead of throwing across the protocol", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"detail":"no credit"}', { status: 402 }));
    const client = await connectedClient(new GridClient({
      apiKey: "grid_test_key",
      baseUrl: "http://127.0.0.1:9999",
      fetch: fetchMock,
    }));

    const output = await client.callTool({
      name: "aipg_get_credits",
      arguments: {},
    });
    expect(output.isError).toBe(true);
    expect(output.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(output)).toContain("402");
  });
});
