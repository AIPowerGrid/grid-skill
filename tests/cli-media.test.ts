// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inlineMediaFile, keyframesFile } from "../src/cli-media.js";
import { parseCliArgs, validateCliInvocation } from "../src/cli-options.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("CLI media files", () => {
  it("encodes file bytes and resolves keyframe image paths beside their JSON file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aipg-cli-media-"));
    directories.push(directory);
    const image = join(directory, "start.png");
    await writeFile(image, Buffer.from([137, 80, 78, 71]));
    const encoded = await inlineMediaFile(image);
    expect(encoded).toBe("data:image/png;base64,iVBORw==");
    const pins = join(directory, "pins.json");
    await writeFile(pins, JSON.stringify([{ image_file: "start.png", frame: 0, strength: 0.7 }]));
    await expect(keyframesFile(pins)).resolves.toEqual([{ image: encoded, frame: 0, strength: 0.7 }]);
    await writeFile(pins, JSON.stringify([{ image_file: "start.png", frame: 337 }]));
    await expect(keyframesFile(pins)).rejects.toThrow("Invalid keyframe");
    await expect(inlineMediaFile(image, "audio")).rejects.toThrow("Unsupported audio");
  });

  it("rejects oversized media instead of encoding or uploading it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aipg-cli-media-"));
    directories.push(directory);
    const path = join(directory, "large.wav");
    await writeFile(path, Buffer.alloc(12 * 1024 * 1024 + 1));
    await expect(inlineMediaFile(path, "audio")).rejects.toThrow("byte limit");
  });

  it("accepts the new controls but rejects flags without values before any file or credential read", () => {
    const invocation = parseCliArgs(["video-submit", "--prompt", "a scene", "--frames", "97", "--reference-audio-file", "music.wav", "--max-cost-micro-usd", "20000", "--idempotency-key", "clip-1"]);
    expect(() => validateCliInvocation(invocation.command, invocation.flags)).not.toThrow();
    const invalid = parseCliArgs(["video-submit", "--max-cost-micro-usd"]);
    expect(() => validateCliInvocation(invalid.command, invalid.flags)).toThrow("requires a value");
  });
});
