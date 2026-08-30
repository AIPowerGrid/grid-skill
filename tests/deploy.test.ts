// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("remote MCP deployment contract", () => {
  it("runs an unprivileged loopback-only process with a protected secret file", async () => {
    const [unit, env] = await Promise.all([
      read("deploy/aipg-mcp.service"),
      read("deploy/mcp.env.example"),
    ]);

    expect(unit).toMatch(/^User=aipg-mcp$/m);
    expect(unit).toMatch(/^Group=aipg-mcp$/m);
    expect(unit).toMatch(/^EnvironmentFile=\/etc\/aipg\/mcp\.env$/m);
    expect(unit).toMatch(/^ConditionFileIsExecutable=\/usr\/bin\/node$/m);
    expect(unit).toMatch(/^ConditionPathIsDirectory=\/opt\/aipg-mcp\/current$/m);
    expect(unit).toMatch(/^Environment=AIPG_MCP_HOST=127\.0\.0\.1$/m);
    expect(unit).toMatch(/^ExecStart=\/usr\/bin\/node \/opt\/aipg-mcp\/current\/dist\/http\.js$/m);
    for (const hardening of [
      "NoNewPrivileges=true",
      "PrivateDevices=true",
      "ProtectHome=true",
      "ProtectSystem=strict",
      "CapabilityBoundingSet=",
    ]) expect(unit).toContain(hardening);
    expect(unit).not.toMatch(/AIPG_MCP_SERVICE_KEY=/);
    expect(env).toMatch(/^AIPG_MCP_SERVICE_KEY=$/m);
    expect(env).not.toMatch(/grid_[A-Za-z0-9_-]{28,}/);
  });

  it("proxies only the bounded MCP route and keeps health private", async () => {
    const nginx = await read("deploy/nginx-location.conf");

    expect(nginx).toMatch(/^location = \/v1\/mcp \{$/m);
    expect(nginx).toMatch(/^\s+client_max_body_size 256k;$/m);
    expect(nginx).toMatch(/^\s+proxy_pass http:\/\/127\.0\.0\.1:8788;$/m);
    expect(nginx).toMatch(/^\s+proxy_buffering off;$/m);
    expect(nginx).toMatch(/^\s+proxy_set_header Authorization \$http_authorization;$/m);
    expect(nginx).not.toMatch(/location\s+.*healthz/);
  });

  it("keeps enablement behind migration, dark-route, canary, and rollback gates", async () => {
    const runbook = await read("deploy/README.md");

    expect(runbook).toContain("GRID_MCP_OAUTH_ENABLED=0");
    expect(runbook).toContain("migration `0031`");
    expect(runbook).toContain("Node.js 22 LTS");
    expect(runbook).toContain("do not use a `curl | sh` installer");
    expect(runbook).toContain("S256 PKCE");
    expect(runbook).toContain("one-use code redemption");
    expect(runbook).toContain("Set `GRID_MCP_OAUTH_ENABLED=0`");
    expect(runbook).toContain("Do not delete audit or OAuth tables");
    expect(runbook).not.toMatch(/GRID_MCP_OAUTH_ENABLED=1/);
  });
});
