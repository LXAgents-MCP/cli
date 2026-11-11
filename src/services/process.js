/**
 * Running a shell command on the host: spawning it, collecting its output, and killing its whole
 * process tree when it outruns its timeout.
 */
import { spawn } from "node:child_process";

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
export function run(command, cwd, timeoutSeconds) {
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
