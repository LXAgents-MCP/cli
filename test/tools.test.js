import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_FILE_BYTES, MAX_LIST_ENTRIES, MAX_OUTPUT, config } from "../src/config.js";
import { Refused } from "../src/tools/common.js";
import { handle as listDirectory } from "../src/tools/list-directory.js";
import { handle as readFile } from "../src/tools/read-file.js";
import { handle as runCommand } from "../src/tools/run-command.js";

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cli-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function resetConfig(t) {
  const saved = { ...config };
  t.after(() => Object.assign(config, saved));
}

const isRefusal = (pattern) => (e) => e instanceof Refused && pattern.test(e.message);

// list_directory

test("list_directory puts directories first, then files, each by case-insensitive name", async (t) => {
  const dir = scratch(t);
  mkdirSync(join(dir, "Zeta"));
  mkdirSync(join(dir, "alpha"));
  writeFileSync(join(dir, "b.txt"), "12345");
  writeFileSync(join(dir, "A.txt"), "");

  const { payload, ok } = await listDirectory({ path: dir });

  assert.equal(ok, true);
  assert.equal(payload.path, dir);
  assert.equal(payload.truncated, false);
  assert.equal(payload.summary, `4 entries in ${dir}.`);
  assert.deepEqual(payload.entries, [
    { name: "alpha", type: "dir", size: payload.entries[0].size },
    { name: "Zeta", type: "dir", size: payload.entries[1].size },
    { name: "A.txt", type: "file", size: 0 },
    { name: "b.txt", type: "file", size: 5 },
  ]);
});

test("list_directory hides dot entries unless asked", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, ".secret"), "");
  writeFileSync(join(dir, "plain"), "");

  const hidden = await listDirectory({ path: dir });
  const shown = await listDirectory({ path: dir, include_hidden: true });

  assert.deepEqual(hidden.payload.entries.map((e) => e.name), ["plain"]);
  assert.deepEqual(shown.payload.entries.map((e) => e.name), [".secret", "plain"]);
});

test("list_directory caps a listing and says so only when something was left out", async (t) => {
  const dir = scratch(t);
  for (let i = 0; i < MAX_LIST_ENTRIES; i += 1) writeFileSync(join(dir, `f${i}`), "");

  const exact = await listDirectory({ path: dir });
  assert.equal(exact.payload.entries.length, MAX_LIST_ENTRIES);
  assert.equal(exact.payload.truncated, false);

  writeFileSync(join(dir, "one-more"), "");
  const over = await listDirectory({ path: dir });
  assert.equal(over.payload.entries.length, MAX_LIST_ENTRIES);
  assert.equal(over.payload.truncated, true);
  assert.match(over.payload.summary, /\(listing capped\)\.$/);
});

test("list_directory reports a dangling link as an entry, not a failure", { skip: process.platform === "win32" }, async (t) => {
  const dir = scratch(t);
  symlinkSync(join(dir, "missing"), join(dir, "dangling"));

  const { payload } = await listDirectory({ path: dir });

  assert.deepEqual(payload.entries, [{ name: "dangling", type: "unreadable", size: 0 }]);
});

test("list_directory refuses a file and a missing directory", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "f"), "");

  await assert.rejects(listDirectory({ path: join(dir, "f") }), isRefusal(/is a file, not a directory/));
  await assert.rejects(listDirectory({ path: join(dir, "nope") }), isRefusal(/does not exist/));
  await assert.rejects(listDirectory({}), isRefusal(/`path` is required/));
});

// read_file

test("read_file returns the contents and strips a UTF-8 byte order mark", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "plain.txt"), "héllo");
  writeFileSync(join(dir, "bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi")]));

  const plain = await readFile({ path: join(dir, "plain.txt") });
  assert.equal(plain.payload.content, "héllo");
  assert.equal(plain.payload.bytes_read, 6);
  assert.equal(plain.payload.truncated, false);

  const bom = await readFile({ path: join(dir, "bom.txt") });
  assert.equal(bom.payload.content, "hi");
});

test("read_file falls back to Windows-1252 for bytes that are not UTF-8", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "legacy.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));

  const { payload } = await readFile({ path: join(dir, "legacy.txt") });

  assert.equal(payload.content, "café");
});

test("read_file stops at max_bytes and tells a file of exactly that size from a longer one", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "ten"), "0123456789");

  const cut = await readFile({ path: join(dir, "ten"), max_bytes: 4 });
  assert.equal(cut.payload.content, "0123");
  assert.equal(cut.payload.truncated, true);
  assert.match(cut.payload.summary, /\(truncated\)\.$/);

  const exact = await readFile({ path: join(dir, "ten"), max_bytes: 10 });
  assert.equal(exact.payload.content, "0123456789");
  assert.equal(exact.payload.truncated, false);

  const floor = await readFile({ path: join(dir, "ten"), max_bytes: 0 });
  assert.equal(floor.payload.bytes_read, 1);
});

test("read_file never reads past the ceiling, however much is asked for", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "big"), "x".repeat(MAX_FILE_BYTES + 10));

  const { payload } = await readFile({ path: join(dir, "big"), max_bytes: MAX_FILE_BYTES * 10 });

  assert.equal(payload.bytes_read, MAX_FILE_BYTES);
  assert.equal(payload.truncated, true);
});

test("read_file refuses a directory, a missing file and a bad max_bytes", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "f"), "x");

  await assert.rejects(readFile({ path: dir }), isRefusal(/is a directory, not a file\. Use list_directory/));
  await assert.rejects(readFile({ path: join(dir, "nope") }), isRefusal(/does not exist/));
  await assert.rejects(readFile({ path: join(dir, "f"), max_bytes: 1.5 }), isRefusal(/`max_bytes` must be an integer, got 1\.5/));
});

// run_command

const NODE = `"${process.execPath}"`;

/**
 * Whether `pid` is a process that is still running.
 *
 * `kill(pid, 0)` also succeeds for a zombie: a process that has been killed and is only waiting
 * for its parent - here, whatever init the host runs - to collect its exit status. Some
 * containers collect lazily, for a second or two. A zombie is dead, so on Linux it is read from
 * `/proc` and not counted.
 */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const state = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0];
    return state !== "Z";
  } catch {
    return true; // no /proc here, or the process vanished between the two reads
  }
}

/** Write a script into `dir` and return the command line that runs it from there. */
function script(dir, name, source) {
  writeFileSync(join(dir, name), source);
  return `${NODE} ${name}`;
}

test("run_command reports a command that succeeds", async (t) => {
  const dir = scratch(t);
  const cmd = script(dir, "ok.js", "console.log('hi'); console.error('careful');");

  const { payload, ok } = await runCommand({ path: dir, cmd });

  assert.equal(ok, true);
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.stdout.trim(), "hi");
  assert.equal(payload.stderr.trim(), "careful");
  assert.equal(payload.timed_out, false);
  assert.equal(payload.truncated, false);
  assert.equal(payload.cwd, dir);
  assert.match(payload.summary, /^Exited 0 in \d+ms\.$/);
});

test("run_command reports a failing command as not ok, with its exit code", async (t) => {
  const dir = scratch(t);
  const cmd = script(dir, "fail.js", "console.log('partial'); process.exit(3);");

  const { payload, ok } = await runCommand({ path: dir, cmd });

  assert.equal(ok, false);
  assert.equal(payload.exit_code, 3);
  assert.equal(payload.stdout.trim(), "partial");
  assert.match(payload.summary, /^Exited 3 in \d+ms\.$/);
});

test("run_command runs where it was told to", async (t) => {
  const dir = scratch(t);
  const sub = join(dir, "sub");
  mkdirSync(sub);
  const cmd = script(sub, "cwd.js", "console.log(process.cwd());");

  const { payload } = await runCommand({ path: sub, cmd });

  assert.equal(realpathSync(payload.stdout.trim()), sub);
});

test("run_command kills a command that outruns its timeout and carries on", async (t) => {
  const dir = scratch(t);
  const cmd = script(dir, "hang.js", "console.log('started'); setInterval(() => {}, 1000);");

  const started = Date.now();
  const { payload, ok } = await runCommand({ path: dir, cmd, timeout: 1 });

  assert.equal(ok, false);
  assert.equal(payload.timed_out, true);
  assert.equal(payload.exit_code, -1);
  assert.match(payload.summary, /^Timed out after 1s and was killed \(exit -1\)\. The server is unaffected\.$/);
  assert.equal(payload.stdout.trim(), "started", "output printed before the kill is kept");
  assert.ok(Date.now() - started < 4000, "the call must return soon after the timeout");
});

test("run_command kills the whole tree, so a grandchild holding the pipes cannot wedge it", async (t) => {
  const dir = scratch(t);
  const cmd = script(
    dir,
    "tree.js",
    `const { spawn } = require("node:child_process");
     const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
     console.log(child.pid);
     setInterval(() => {}, 1000);`,
  );

  const started = Date.now();
  const { payload } = await runCommand({ path: dir, cmd, timeout: 1 });
  const grandchild = Number(payload.stdout.trim());

  assert.equal(payload.timed_out, true);
  assert.ok(Number.isInteger(grandchild) && grandchild > 0, "the script reports its child's pid");
  // The drain backstop is 5 s. Returning sooner means the kill reached the grandchild.
  assert.ok(Date.now() - started < 4000, "the grandchild's pipes must not hold the call open");

  // The grandchild is gone, not merely detached from the pipes. The wait is a ceiling, not a
  // delay: the loop ends the moment the process is dead.
  let alive = true;
  for (let i = 0; i < 200 && alive; i += 1) {
    alive = isRunning(grandchild);
    if (alive) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(alive, false, "the grandchild must not outlive the timeout");
});

test("run_command closes stdin instead of lending out the protocol channel", async (t) => {
  const dir = scratch(t);
  const cmd = script(
    dir,
    "stdin.js",
    "process.stdin.resume(); process.stdin.on('end', () => console.log('eof'));",
  );

  const { payload } = await runCommand({ path: dir, cmd, timeout: 5 });

  assert.equal(payload.stdout.trim(), "eof");
  assert.equal(payload.timed_out, false);
});

test("run_command cuts output at the ceiling and says so", async (t) => {
  const dir = scratch(t);
  const cmd = script(dir, "loud.js", `process.stdout.write("x".repeat(${MAX_OUTPUT + 5000}));`);

  const { payload } = await runCommand({ path: dir, cmd });

  assert.equal(payload.truncated, true);
  assert.ok(payload.stdout.endsWith("\n... (truncated)"));
});

test("run_command decodes output that is not UTF-8", async (t) => {
  const dir = scratch(t);
  const cmd = script(dir, "legacy.js", "process.stdout.write(Buffer.from([0x63, 0x61, 0x66, 0xe9]));");

  const { payload } = await runCommand({ path: dir, cmd });

  assert.equal(payload.stdout, "café");
});

test("run_command honours the allowlist", async (t) => {
  resetConfig(t);
  const dir = scratch(t);
  config.allowedExecutables = ["git"];

  await assert.rejects(
    runCommand({ path: dir, cmd: `${NODE} -v` }),
    isRefusal(/not in the allowlist\. Allowed: git\./),
  );
});

test("run_command uses the configured default timeout when a call names none", async (t) => {
  resetConfig(t);
  const dir = scratch(t);
  config.defaultTimeout = 1;
  const cmd = script(dir, "hang.js", "setInterval(() => {}, 1000);");

  const { payload } = await runCommand({ path: dir, cmd });

  assert.equal(payload.timed_out, true);
  assert.match(payload.summary, /^Timed out after 1s/);
});

test("run_command refuses a missing command and a missing directory", async (t) => {
  const dir = scratch(t);

  for (const cmd of [undefined, "", "   ", 7]) {
    await assert.rejects(runCommand({ path: dir, cmd }), isRefusal(/`cmd` is required/));
  }
  await assert.rejects(runCommand({ path: join(dir, "nope"), cmd: "echo hi" }), isRefusal(/does not exist/));
  await assert.rejects(runCommand({ cmd: "echo hi" }), isRefusal(/`path` is required/));
});
