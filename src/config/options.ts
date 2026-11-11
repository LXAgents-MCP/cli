/**
 * Command-line options, parsed without side effects. `src/index.ts` applies them to `config`, so
 * this module reads nothing and depends on nothing above it.
 */
import { parseArgs } from "node:util";

export const USAGE = `Host CLI MCP Server

Usage: node dist/index.js [options]

Options:
  --confine DIR     Refuse to act outside this directory
  --allow CMD,...   Comma-separated executables allowed to run
  --timeout SEC     Default command timeout in seconds (30 if unset)
  -h, --help        Show this help
`;

/** A bad command line. The message is for the person who typed it. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** What the command line asked for. A flag that was not passed is absent. */
export interface Options {
  confine?: string;
  allow?: string[];
  timeout?: number;
  help: boolean;
}

/** The raw values `parseArgs` returns for the options below. */
interface RawValues {
  confine?: string;
  allow?: string;
  timeout?: string;
  help?: boolean;
}

/**
 * @param argv Arguments after the script name.
 */
export function parseOptions(argv: string[]): Options {
  let values: RawValues;
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
    throw new UsageError((error as Error).message);
  }

  const options: Options = { help: Boolean(values.help) };

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
