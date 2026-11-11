/**
 * Where a tool may act: real-path resolution and the `--confine` check.
 *
 * Nothing here writes to stdout: stdout is the protocol channel and belongs to the SDK's transport.
 */
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { config } from "../config/config.js";
import { Refused } from "../utils/errors.js";

/** How `resolvePath` treats what it finds. */
export interface ResolveOptions {
  /** Refuse a path that is missing or is not a directory. Default true. */
  mustBeDir?: boolean;
}

/**
 * Resolve a path the way a non-strict realpath does: follow links through the part that
 * exists and keep the rest literal.
 *
 * `fs.realpathSync` throws on a path that does not exist yet, which would make "does not
 * exist" indistinguishable from "outside the root" for a path that is both. Walking up to the
 * nearest existing ancestor keeps the confinement check meaningful either way.
 *
 * @param absolute An absolute path.
 */
export function resolveReal(absolute: string): string {
  const rest: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      return join(realpathSync(current), ...rest.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      rest.push(basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Resolve the required `path` argument into a usable absolute path.
 *
 * `path` is required on every tool. There is no default directory: the server has no opinion
 * about where your code lives, and guessing one is how a tool ends up writing somewhere you
 * did not ask for. A relative path is resolved against the server process's own working
 * directory, which is where the client started it.
 *
 * When the server was started with --confine <dir>, resolving through real paths is what makes
 * the check real: it collapses `..` and follows symlinks, so neither traversal nor a link out
 * of the tree gets past it.
 */
export function resolvePath(raw: unknown, { mustBeDir = true }: ResolveOptions = {}): string {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    throw new Refused(
      "`path` is required and must be a non-empty string. There is no default; pass one explicitly.",
    );
  }
  if (typeof raw !== "string") {
    throw new Refused(`\`path\` must be a string, got ${typeof raw}.`);
  }

  const resolved = resolveReal(resolve(process.cwd(), raw));

  const root = config.confineRoot;
  if (root !== null && !isInside(root, resolved)) {
    throw new Refused(
      `\`path\` resolved to ${resolved}, which is outside the allowed root ${root}. ` +
        "Pass a path inside the root, or restart the server without --confine.",
    );
  }

  if (mustBeDir) {
    const stat = statSync(resolved, { throwIfNoEntry: false });
    if (stat === undefined) throw new Refused(`\`path\` ${resolved} does not exist.`);
    if (!stat.isDirectory()) throw new Refused(`\`path\` ${resolved} is a file, not a directory.`);
  }

  return resolved;
}
