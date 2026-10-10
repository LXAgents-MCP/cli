/**
 * Shared helpers for the tool modules. Nothing here writes to stdout: stdout is the protocol
 * channel and belongs to the SDK's transport.
 */
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { API_TIMEOUT_MS, config, MAX_OUTPUT, MAX_TIMEOUT } from "../config.js";

/** A request the owner would not want served. Carries a message worth reading. */
export class Refused extends Error {
  constructor(message) {
    super(message);
    this.name = "Refused";
  }
}

/**
 * Resolve a path the way a non-strict realpath does: follow links through the part that
 * exists and keep the rest literal.
 *
 * `fs.realpathSync` throws on a path that does not exist yet, which would make "does not
 * exist" indistinguishable from "outside the root" for a path that is both. Walking up to the
 * nearest existing ancestor keeps the confinement check meaningful either way.
 *
 * @param {string} absolute An absolute path.
 * @returns {string}
 */
export function resolveReal(absolute) {
  const rest = [];
  let current = absolute;

  for (;;) {
    try {
      return join(realpathSync(current), ...rest.reverse());
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      rest.push(basename(current));
      current = parent;
    }
  }
}

function isInside(root, target) {
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
 *
 * @param {unknown} raw
 * @param {{ mustBeDir?: boolean }} [options]
 * @returns {string}
 */
export function resolvePath(raw, { mustBeDir = true } = {}) {
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

/**
 * The executable in a command line, for the allowlist check.
 *
 * Best effort by nature - a shell line can build its executable any number of ways - which is
 * why the allowlist is a narrowing measure and not a boundary. The name is the file stem of
 * the first token, lowercased, so `"C:\Tools\Git.exe" status` and `git status` both read `git`.
 *
 * @param {string} command
 * @returns {string}
 */
export function firstToken(command) {
  const text = command.trimStart();
  const quote = text[0];
  let token;

  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    token = end === -1 ? text.slice(1) : text.slice(1, end);
  } else {
    token = text.split(/\s/, 1)[0];
  }

  // win32.parse understands both separators on every platform, so a Windows path in an
  // allowlisted command reads the same on a POSIX host.
  return win32.parse(token).name.toLowerCase();
}

/** @param {string} command */
export function checkAllowlist(command) {
  if (config.allowedExecutables.length === 0) return;

  const token = firstToken(command);
  if (!config.allowedExecutables.includes(token)) {
    const allowed = [...config.allowedExecutables].sort().join(", ");
    throw new Refused(
      `\`cmd\` starts with '${token}', which is not in the allowlist. Allowed: ${allowed}.`,
    );
  }
}

/**
 * Seconds to wait, clamped to what the server permits.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function clampTimeout(value) {
  if (value === undefined || value === null) return config.defaultTimeout;

  const requested = Number(value);
  if (!Number.isFinite(requested)) return config.defaultTimeout;
  return Math.max(1, Math.min(requested, MAX_TIMEOUT));
}

/**
 * Decode bytes as UTF-8, falling back to Windows-1252 when they are not valid UTF-8.
 *
 * The byte order mark is kept in the string (`ignoreBOM`) so a caller that cares can strip it
 * explicitly, instead of the decoder doing it for UTF-8 only and leaving it as mojibake for the
 * fallback.
 *
 * @param {Uint8Array} payload
 * @returns {string}
 */
export function decode(payload) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
  } catch {
    return new TextDecoder("windows-1252").decode(payload);
  }
}

/**
 * @param {string} text
 * @returns {[string, boolean]} The text, cut to the output ceiling, and whether it was cut.
 */
export function truncate(text) {
  if (text.length > MAX_OUTPUT) {
    return [`${text.slice(0, MAX_OUTPUT)}\n... (truncated)`, true];
  }
  return [text, false];
}

/**
 * Read an API token from the environment, at call time.
 *
 * Read per call and not at startup, so a server without a token still starts and serves its
 * other tools. The token comes from the `env` block of the client's configuration for this
 * server; it is never an argument, so it never appears in a prompt or a transcript.
 *
 * @param {string} envName
 * @returns {string}
 */
export function requireToken(envName) {
  const token = process.env[envName]?.trim();
  if (!token) {
    throw new Refused(
      `${envName} is not set. Add it to the \`env\` block of this server's entry in the ` +
        "client configuration, then restart the client.",
    );
  }
  return token;
}

/**
 * Remove a secret from text that is about to be shown.
 *
 * @param {unknown} text
 * @param {string} secret
 * @returns {string}
 */
export function redact(text, secret) {
  return secret ? String(text).split(secret).join("***") : String(text);
}

/**
 * An optional string argument: trimmed, and `undefined` when absent or blank.
 *
 * @param {unknown} value
 * @param {string} field
 * @returns {string | undefined}
 */
export function optionalText(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Refused(`\`${field}\` must be a string, got ${typeof value}.`);
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * An optional boolean argument, with the value to use when it is absent.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function optionalFlag(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Refused(`\`${field}\` must be true or false, got ${typeof value}.`);
  return value;
}

/**
 * Call a hosting API and return its status and decoded body.
 *
 * Every failure to get an answer - no network, a refused connection, a timeout - becomes a
 * `Refused` the model can read and act on. A non-2xx answer is not a failure here: the caller
 * knows what each status means for its service. `token` is only used to scrub error text; the
 * caller puts the credential in `headers`.
 *
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, json?: unknown, token?: string }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function callApi(url, { method = "GET", headers = {}, json, token = "" } = {}) {
  const host = new URL(url).host;
  const init = {
    method,
    headers: json === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  };
  if (json !== undefined) init.body = JSON.stringify(json);

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Refused(`${host} did not answer within ${API_TIMEOUT_MS / 1000} seconds. Try again.`);
    }
    const reason = redact(error?.cause?.message ?? error?.message ?? error, token);
    throw new Refused(`Could not reach ${host}: ${reason}. Check the network connection.`);
  }

  const raw = await response.text();
  let body = null;
  if (raw !== "") {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw.slice(0, 300);
    }
  }
  return { status: response.status, body };
}
