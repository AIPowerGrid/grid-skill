// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { parseCliArgs, validateCliInvocation } from "../src/cli-options.js";

describe("CLI argument contract", () => {
  it("normalizes documented flags and preserves their values", () => {
    expect(parseCliArgs([
      "quote",
      "--model",
      "Krea 2 Turbo",
      "--max-tokens",
      "512",
    ])).toEqual({
      command: "quote",
      flags: { model: "Krea 2 Turbo", max_tokens: "512" },
    });
  });

  it("supports the global help spelling without treating it as an unknown command", () => {
    const invocation = parseCliArgs(["--help"]);
    expect(invocation).toEqual({ command: "help", flags: {} });
    expect(() => validateCliInvocation(invocation.command, invocation.flags)).not.toThrow();
  });

  it("rejects positional arguments and duplicate flags", () => {
    expect(() => parseCliArgs(["text", "hello"])).toThrow("Unexpected positional argument");
    expect(() => parseCliArgs(["text", "--prompt", "one", "--prompt", "two"]))
      .toThrow("--prompt may be specified only once");
  });

  it("rejects credential-like command and inline spellings without echoing values", () => {
    expect(() => parseCliArgs(["--api-key", "super-secret"]))
      .toThrow("Unknown option before command");
    expect(() => parseCliArgs(["text", "--api-key=super-secret"]))
      .toThrow("Inline option values are not supported");
  });

  it("rejects unknown commands before authentication or network work", () => {
    expect(() => validateCliInvocation("surprise", {})).toThrow("Unknown command: surprise");
  });

  it("rejects credential-like and unrelated command flags", () => {
    const credential = parseCliArgs(["text", "--prompt", "hello", "--api-key", "do-not-use"]);
    expect(() => validateCliInvocation(credential.command, credential.flags))
      .toThrow('--api-key is not supported by command "text"');

    const unrelated = parseCliArgs(["models", "--seconds", "4"]);
    expect(() => validateCliInvocation(unrelated.command, unrelated.flags))
      .toThrow('--seconds is not supported by command "models"');
  });

  it("does not let special object property names bypass the allowlist", () => {
    const invocation = parseCliArgs(["models", "--__proto__", "value"]);
    expect(() => validateCliInvocation(invocation.command, invocation.flags))
      .toThrow('--[invalid-option] is not supported by command "models"');
  });

  it("allows help for any known command but no other undocumented flag", () => {
    expect(() => validateCliInvocation("audio", { help: true })).not.toThrow();
    expect(() => validateCliInvocation("login", { no_open: true })).not.toThrow();
    expect(() => validateCliInvocation("audio", { help: "yes" }))
      .toThrow("--help does not accept a value");
    expect(() => validateCliInvocation("login", { no_open: "false" }))
      .toThrow("--no-open does not accept a value");
  });
});
