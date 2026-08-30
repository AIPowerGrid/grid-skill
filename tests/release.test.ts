// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("npm release contract", () => {
  it("publishes only from a matching tag with provenance", async () => {
    const [workflow, packageJson, packageLock] = await Promise.all([
      read(".github/workflows/publish.yml"),
      read("package.json").then((value) => JSON.parse(value)),
      read("package-lock.json").then((value) => JSON.parse(value)),
    ]);

    expect(packageJson.name).toBe("@aipowergrid/mcp");
    expect(packageJson.bin).toEqual({
      aipg: "dist/cli.js",
      "aipg-mcp": "dist/stdio.js",
      "aipg-mcp-http": "dist/http.js",
    });
    expect(packageLock.packages[""].bin).toEqual(packageJson.bin);
    expect(packageJson.dependencies["@modelcontextprotocol/node"]).toBe("2.0.0");
    expect(workflow).toMatch(/tags:\s*\n\s+- "mcp-v\*\.\*\.\*"/);
    expect(workflow).toMatch(/expected="mcp-v\$\(node -p/);
    expect(workflow).toMatch(/fetch-depth: 0/);
    expect(workflow).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
    expect(workflow).toMatch(/npm run check/);
    expect(workflow).toMatch(/npm publish --access public --provenance/);
    expect(workflow).not.toContain("NPM_TOKEN");
    expect(workflow).toMatch(/id-token: write/);
    expect(workflow).toMatch(/package-manager-cache: false/);
    expect(workflow).toMatch(/cancel-in-progress: false/);
  });

  it("pins every third-party Action to a full commit", async () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/publish.yml"]) {
      const workflow = await read(path);
      const references = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) expect(reference).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
