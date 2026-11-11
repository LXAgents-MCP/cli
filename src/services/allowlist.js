/** Which executable a command line starts, and the `--allow` check on it. */
import { win32 } from "node:path";
import { config } from "../config/config.js";
import { Refused } from "../utils/errors.js";

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
