// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

export type CliFlags = Record<string, string | boolean>;

const COMMAND_FLAGS: Record<string, ReadonlySet<string>> = {
  help: new Set(),
  models: new Set(),
  login: new Set(["no_open"]),
  logout: new Set(),
  "auth-status": new Set(),
  credits: new Set(),
  quote: new Set(["model", "modality", "prompt_tokens", "max_tokens", "n", "seconds"]),
  text: new Set(["prompt", "model", "system", "max_tokens", "temperature"]),
  image: new Set(["prompt", "model", "n", "size", "seed", "negative_prompt", "style"]),
  video: new Set(["prompt", "model", "seconds", "fps", "size", "seed", "image", "style"]),
  audio: new Set([
    "prompt",
    "lyrics",
    "model",
    "seconds",
    "inference_steps",
    "bpm",
    "key_scale",
    "time_signature",
    "vocal_language",
    "seed",
  ]),
  mcp: new Set(),
};

const BOOLEAN_FLAGS = new Set(["help", "no_open"]);

function displayFlag(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) return "--[invalid-option]";
  return `--${name.replaceAll("_", "-")}`;
}

export function parseCliArgs(args: string[]): { command: string | undefined; flags: CliFlags } {
  const [rawCommand, ...rest] = args;
  if (rawCommand?.startsWith("--") && rawCommand !== "--help") {
    throw new Error("Unknown option before command");
  }
  const command = rawCommand === "--help" ? "help" : rawCommand;
  const flags = Object.create(null) as CliFlags;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--") || token.length === 2) {
      throw new Error("Unexpected positional argument");
    }
    if (token.includes("=")) throw new Error("Inline option values are not supported");
    const name = token.slice(2).replaceAll("-", "_");
    if (Object.hasOwn(flags, name)) throw new Error(`${displayFlag(name)} may be specified only once`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = value;
      index += 1;
    }
  }

  return { command, flags };
}

export function validateCliInvocation(command: string | undefined, flags: CliFlags): void {
  if (!command) return;
  const allowed = COMMAND_FLAGS[command];
  if (!allowed) throw new Error(`Unknown command: ${command}`);

  for (const name of Object.keys(flags)) {
    if (name !== "help" && !allowed.has(name)) {
      throw new Error(`${displayFlag(name)} is not supported by command "${command}"`);
    }
    if (BOOLEAN_FLAGS.has(name) && flags[name] !== true) {
      throw new Error(`${displayFlag(name)} does not accept a value`);
    }
  }
}
