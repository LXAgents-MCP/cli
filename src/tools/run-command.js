/** Run a command on the host machine. */
import { spawn } from "node:child_process";
import { z } from "zod";
import { MAX_TIMEOUT } from "../config.js";
import { Refused, checkAllowlist, clampTimeout, decode, resolvePath, truncate } from "./common.js";

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

/** How long, after the kill, to wait for the pipes to drain before giving up on them. */
const DRAIN_MS = 5000;

/**
 * Kill a command and everything it spawned.
 *
 * Necessary because `shell: true` means the shell starts the real work as a child. Killing only
 * the shell leaves that grandchild running, still holding the stdout pipe - so the read below
 * would block until the orphan finishes anyway, and a "2 second" timeout could come back twenty
 * seconds later with the server wedged in the meantime.
 *
 * Windows has no process groups to signal, so `taskkill /T` walks the tree. Elsewhere the child
 * was started as its own group leader (`detached`), and a negative pid signals the whole group.
 *
 * @param {import("node:child_process").ChildProcess} child
 */
function killTree(child) {
  if (child.pid === undefined) return;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    // taskkill's failure is not interesting: the plain kill below is the fallback.
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Run `command`, resolving with its output and exit code once it ends or is killed.
 *
 * stdin is closed rather than inherited. This process's stdin is the protocol channel, and a
 * child that inherited it could read the client's next message or sit waiting on input that
 * never comes until the timeout kills it.
 *
 * @param {string} command
 * @param {string} cwd
 * @param {number} timeoutSeconds
 * @returns {Promise<{ stdout: Buffer, stderr: Buffer, exitCode: number, timedOut: boolean }>}
 */
function run(command, cwd, timeoutSeconds) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let settled = false;
    let timer;
    let backstop;

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(backstop);
      resolvePromise({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode,
        timedOut,
      });
    };

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    child.on("error", (error) => {
      stderr.push(Buffer.from(`${error.message}\n`));
      finish(-1);
    });
    child.on("close", (code) => finish(timedOut ? -1 : (code ?? -1)));

    timer = setTimeout(() => {
      // Report the timeout rather than failing silently: a caller that waited 30 seconds
      // deserves to know the command was killed and not merely that nothing came back.
      timedOut = true;
      killTree(child);
      // Whatever the command printed before it died is kept, so a timeout does not also throw
      // away the build output that explains why it hung. If a survivor still holds a pipe,
      // stop waiting for it.
      backstop = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(-1);
      }, DRAIN_MS);
    }, timeoutSeconds * 1000);
  });
}

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
