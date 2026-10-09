/** List what is in a directory on the host. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MAX_LIST_ENTRIES } from "../config.js";
import { resolvePath } from "./common.js";

export const TOOL = {
  name: "list_directory",
  description:
    "List what is in a directory on the host, with a type marker per entry. Use this to " +
    "find out what exists before deciding what to run - it is cheaper than a command, " +
    "and it does not execute anything. Read-only.",
  inputSchema: {
    path: z
      .string()
      .describe(
        "Directory to list. Required - there is no default. Absolute, or " +
          "relative to the server's own working directory.",
      ),
    include_hidden: z
      .boolean()
      .optional()
      .describe("Include dot-prefixed and hidden entries. Default false."),
  },
  outputSchema: {
    path: z.string(),
    entries: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        size: z.number().int(),
      }),
    ),
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
 * @param {{ path?: unknown, include_hidden?: unknown }} args
 * @returns {Promise<{ payload: object, ok: boolean }>}
 */
export async function handle(args) {
  const target = resolvePath(args.path);
  const includeHidden = Boolean(args.include_hidden);
  const found = [];

  for (const name of readdirSync(target)) {
    if (!includeHidden && name.startsWith(".")) continue;

    let size = 0;
    let type = "unreadable";
    let isFile = false;
    try {
      const stat = statSync(join(target, name));
      size = stat.size;
      isFile = stat.isFile();
      type = stat.isDirectory() ? "dir" : "file";
    } catch {
      // A dangling link or a permission wall is an entry, not a failure.
    }

    found.push({ name, type, size, isFile });
  }

  // Directories first, then files, each group by case-insensitive name.
  found.sort(
    (a, b) =>
      Number(a.isFile) - Number(b.isFile) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  const truncated = found.length > MAX_LIST_ENTRIES;
  const entries = found
    .slice(0, MAX_LIST_ENTRIES)
    .map(({ name, type, size }) => ({ name, type, size }));

  return {
    payload: {
      summary: `${entries.length} entries in ${target}` + (truncated ? " (listing capped)." : "."),
      path: target,
      entries,
      truncated,
    },
    ok: true,
  };
}
