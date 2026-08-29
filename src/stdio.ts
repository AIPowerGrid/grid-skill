#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { resolveGridCredential } from "./auth.js";
import { GridClient } from "./client.js";
import { createGridMcpServer } from "./mcp.js";

const credential = await resolveGridCredential();
const client = !credential
  ? new GridClient()
  : credential.source === "api_key"
    ? new GridClient({ apiKey: credential.token })
    : new GridClient({ accessToken: credential.token });

serveStdio(() => createGridMcpServer(client), {
  onerror(error) {
    console.error(`aipg-mcp: ${error.message}`);
  },
});
