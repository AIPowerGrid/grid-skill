#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRemoteMcpHttpServer, MCP_PATH } from "./remote.js";

function portFromEnvironment(): number {
  const value = Number(process.env.AIPG_MCP_PORT ?? "8788");
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("AIPG_MCP_PORT must be an integer from 1 through 65535");
  }
  return value;
}

function hostFromEnvironment(): string {
  const value = process.env.AIPG_MCP_HOST ?? "127.0.0.1";
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(value)) {
    throw new Error("AIPG_MCP_HOST must be a loopback address; expose the service through the trusted reverse proxy");
  }
  return value;
}

const port = portFromEnvironment();
const host = hostFromEnvironment();
const server = createRemoteMcpHttpServer();

server.listen(port, host, () => {
  console.error(`aipg-mcp-http: listening on http://${host}:${port}${MCP_PATH}`);
});

async function shutdown(signal: string): Promise<void> {
  console.error(`aipg-mcp-http: received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error(`aipg-mcp-http: shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
