#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createGridMcpServer } from "./mcp.js";

serveStdio(() => createGridMcpServer(), {
  onerror(error) {
    console.error(`aipg-mcp: ${error.message}`);
  },
});
