/**
 * Command-line options, parsed without side effects. `src/index.js` applies them to `config`, so
 * this module reads nothing and depends on nothing above it.
 */
import { parseArgs } from "node:util";

export const USAGE = `Host CLI MCP Server

Usage: node src/index.js [options]

Options:
  --confine DIR     Refuse to act outside this directory
  --allow CMD,...   Comma-separated executables allowed to run
  --timeout SEC     Default command timeout in seconds (30 if unset)
  -h, --help        Show this help
`;

/** A bad command line. The message is for the person who typed it. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {{ confine?: string, allow?: string[], timeout?: number, help: boolean }}
 */
export function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        confine: { type: "string" },
        allow: { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }

  const options = { help: Boolean(values.help) };

  if (values.confine) options.confine = values.confine;

  if (values.allow) {
    options.allow = values.allow
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
  }

  if (values.timeout !== undefined) {
    const seconds = Number(values.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new UsageError(`--timeout must be a positive number of seconds, got '${values.timeout}'.`);
    }
    options.timeout = seconds;
  }

  return options;
}
