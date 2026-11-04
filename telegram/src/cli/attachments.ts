// Files for `tg send --photo` and `tg send --document`: resolve, check, and size-limit them in the CLI,
// so a bad path fails with a clear message before anything is sent.

import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export type AttachmentKind = "photo" | "document";

export interface Attachment {
  kind: AttachmentKind;
  path: string;
  caption?: string;
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// The daemon runs in another directory, so the path it receives must be absolute. The daemon is reached over a
// unix socket, so it is always on this machine and reads the same file; there is no upload.
export function resolveAttachmentPath(kind: AttachmentKind, rawPath: string, cwd: string = process.cwd()): string {
  const flag = `--${kind}`;
  if (!rawPath) throw new Error(`${flag} needs a file path`);
  const abs = path.resolve(cwd, rawPath);
  let stats;
  try {
    stats = statSync(abs);
  } catch {
    throw new Error(`${flag}: ${abs} does not exist`);
  }
  if (!stats.isFile()) throw new Error(`${flag}: ${abs} is not a file`);
  try {
    accessSync(abs, constants.R_OK);
  } catch {
    throw new Error(`${flag}: ${abs} is not readable`);
  }
  if (stats.size === 0) throw new Error(`${flag}: ${abs} is empty`);
  if (kind === "photo") {
    if (!PHOTO_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
      throw new Error(`--photo: ${abs} is not a png, jpg, jpeg, gif or webp image (use --document to send any file)`);
    }
    if (stats.size > MAX_PHOTO_BYTES) {
      throw new Error(`--photo: ${abs} is larger than the 10 MB Telegram photo limit (use --document, up to 50 MB)`);
    }
  } else if (stats.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`--document: ${abs} is larger than the 50 MB Telegram document limit`);
  }
  return abs;
}
