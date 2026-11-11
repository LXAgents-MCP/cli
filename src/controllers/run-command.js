/** Run a command on the host machine. */
import { z } from "zod";
import { MAX_TIMEOUT } from "../config/config.js";
import { clampTimeout } from "../models/args.js";
import { checkAllowlist } from "../services/allowlist.js";
import { resolvePath } from "../services/paths.js";
import { run } from "../services/process.js";
import { Refused } from "../utils/errors.js";
import { decode, truncate } from "../utils/text.js";

export const TOOL = {
  name: "run_command",
  description:
    "Run a command on the host machine and return its exit code, stdout, stderr, and " +
    "duration. Use this when work has to happen on the host - running scripts, " +
    "invoking a build or test runner, or inspecting host state the sandbox " +
    "cannot see. Any directory on the machine may be used. A command that outruns " +
    "`timeout` has its whole process tree killed, and the server carries on serving.",
  inputSchema: {
    path: z
      .string()
      .describe(
        "Working directory. Required - there is no default. Absolute, or " +
          "relative to the server's own working directory. A path that does not " +
          "exist is refused.",
      ),
    cmd: z
      .string()
      .describe(
        "The command line, run through the host shell (cmd.exe on Windows, /bin/sh " +
          "elsewhere). Quote paths containing spaces. Example: 'node main.js --dry-run'.",
      ),
    timeout: z
      .number()
      .optional()
      .describe(
        "Seconds to wait. Defaults to the server's setting (30 unless it was started " +
          `with --timeout), ceiling ${MAX_TIMEOUT}. A command that exceeds it is killed and ` +
          "reported as a timeout - the server stays up and keeps serving.",
      ),
  },
  outputSchema: {
    exit_code: z.number().int(),
    stdout: z.string(),
    stderr: z.string(),
    duration_ms: z.number().int().optional(),
    truncated: z.boolean().optional(),
    timed_out: z.boolean(),
    cwd: z.string(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

/**
 * @param {{ path?: unknown, cmd?: unknown, timeout?: unknown }} args
 * @returns {Promise<{ payload: object, ok: boolean }>}
 */
export async function handle(args) {
  const cwd = resolvePath(args.path);
  const command = args.cmd;

  if (typeof command !== "string" || command.trim() === "") {
    throw new Refused(
      "`cmd` is required and must be a non-empty string, for example 'node main.js --dry-run'.",
    );
  }

  checkAllowlist(command);
  const timeout = clampTimeout(args.timeout);

  const started = performance.now();
  const result = await run(command, cwd, timeout);
  const durationMs = Math.trunc(performance.now() - started);

  const [stdout, cutOut] = truncate(decode(result.stdout));
  const [stderr, cutErr] = truncate(decode(result.stderr));

  let summary;
  if (result.timedOut) {
    summary =
      `Timed out after ${timeout.toFixed(0)}s and was killed (exit ${result.exitCode}). ` +
      "The server is unaffected.";
  } else if (result.exitCode === 0) {
    summary = `Exited 0 in ${durationMs}ms.`;
  } else {
    summary = `Exited ${result.exitCode} in ${durationMs}ms.`;
  }

  return {
    payload: {
      summary,
      exit_code: result.exitCode,
      stdout,
      stderr,
      duration_ms: durationMs,
      truncated: cutOut || cutErr,
      timed_out: result.timedOut,
      cwd,
    },
    ok: result.exitCode === 0 && !result.timedOut,
  };
}
