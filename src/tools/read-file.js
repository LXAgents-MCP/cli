/** Read a text file from the host. */
import { open } from "node:fs/promises";
import { statSync } from "node:fs";
import { z } from "zod";
import { MAX_FILE_BYTES } from "../config.js";
import { Refused, decode, resolvePath } from "./common.js";

export const TOOL = {
  name: "read_file",
  description:
    "Read a text file from the host and return its contents. Use this instead of shelling " +
    "out to `type` or `cat`: it handles Windows encodings and a byte cap, and it will " +
    "not mangle a file the way a console pipe does. Read-only.",
  inputSchema: {
    path: z
      .string()
      .describe(
        "File to read. Required - there is no default. Absolute, or relative to " +
          "the server's own working directory. Must be an existing file.",
      ),
    max_bytes: z
      .number()
      .int()
      .optional()
      .describe(`Maximum bytes to read. Default and ceiling ${MAX_FILE_BYTES}.`),
  },
  outputSchema: {
    path: z.string(),
    content: z.string(),
    bytes_read: z.number().int(),
    truncated: z.boolean(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/**
 * @param {{ path?: unknown, max_bytes?: unknown }} args
 * @returns {Promise<{ payload: object, ok: boolean }>}
 */
export async function handle(args) {
  const target = resolvePath(args.path, { mustBeDir: false });

  const stat = statSync(target, { throwIfNoEntry: false });
  if (stat === undefined) throw new Refused(`\`path\` ${target} does not exist.`);
  if (stat.isDirectory()) {
    throw new Refused(
      `\`path\` ${target} is a directory, not a file. Use list_directory on it instead.`,
    );
  }

  let limit = MAX_FILE_BYTES;
  if (args.max_bytes !== undefined && args.max_bytes !== null) {
    if (!Number.isInteger(args.max_bytes)) {
      throw new Refused(`\`max_bytes\` must be an integer, got ${JSON.stringify(args.max_bytes)}.`);
    }
    limit = Math.max(1, Math.min(args.max_bytes, MAX_FILE_BYTES));
  }

  // One byte past the limit is how a file of exactly `limit` bytes is told from a longer one.
  const buffer = Buffer.alloc(limit + 1);
  const file = await open(target, "r");
  let bytesRead;
  try {
    ({ bytesRead } = await file.read(buffer, 0, limit + 1, 0));
  } finally {
    await file.close();
  }

  const truncated = bytesRead > limit;
  const raw = buffer.subarray(0, Math.min(bytesRead, limit));

  let text = decode(raw);
  // A UTF-8 BOM is an encoding artefact, not content.
  if (text.startsWith("﻿")) text = text.slice(1);

  return {
    payload: {
      summary: `Read ${raw.length} bytes from ${target}` + (truncated ? " (truncated)." : "."),
      path: target,
      content: text,
      bytes_read: raw.length,
      truncated,
    },
    ok: true,
  };
}
