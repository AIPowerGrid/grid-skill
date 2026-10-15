// SPDX-FileCopyrightText: 2026 AI Power Grid
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createReadStream } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { GRID_MAX_REQUEST_BYTES, videoKeyframeSchema } from "./requests.js";

async function boundedFile(path: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of createReadStream(path)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    length += chunk.length;
    if (length > maxBytes) throw new Error(`Media file exceeds its ${maxBytes}-byte limit`);
    chunks.push(chunk);
  }
  if (!length) throw new Error("Media file is empty");
  return Buffer.concat(chunks);
}

export async function inlineMediaFile(path: string, role: "image" | "audio" | "video" = "image"): Promise<string> {
  const suffix = extname(path).toLowerCase();
  const mime = role === "audio" ? (suffix === ".wav" ? "audio/wav" : undefined)
    : role === "video" ? (suffix === ".mp4" ? "video/mp4" : undefined)
      : ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[suffix];
  if (!mime) throw new Error(`Unsupported ${role} file extension`);
  const data = await boundedFile(path, (role === "video" ? 32 : 12) * 1024 * 1024);
  return `data:${mime};base64,${data.toString("base64")}`;
}

export async function keyframesFile(path: string): Promise<Array<{ image: string; frame: number; strength?: number | undefined }>> {
  let value: unknown;
  try { value = JSON.parse((await boundedFile(path, 64 * 1024)).toString("utf8")); }
  catch { throw new Error("Keyframes file must be valid JSON, at most 64 KiB"); }
  if (!Array.isArray(value) || value.length > 16) throw new Error("Keyframes file must contain an array of at most 16 entries");
  const output = [];
  let encodedBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid keyframe entry");
    const { image_file, ...rest } = item as Record<string, unknown>;
    if (typeof image_file !== "string" || !image_file || "image" in rest) {
      throw new Error("Each keyframe must specify image_file, frame and optional strength");
    }
    const image = await inlineMediaFile(resolve(dirname(path), image_file));
    encodedBytes += Buffer.byteLength(image);
    if (encodedBytes > GRID_MAX_REQUEST_BYTES - 64 * 1024) throw new Error("Keyframe images exceed the shared 64 MiB encoded-media limit");
    const parsed = videoKeyframeSchema.safeParse({ ...rest, image });
    if (!parsed.success) throw new Error("Invalid keyframe frame, strength or fields");
    output.push(parsed.data);
  }
  return output;
}
