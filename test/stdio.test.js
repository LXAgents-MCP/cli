import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/*
 * The server as a client actually runs it: a real process, spoken to over a real pipe. The
 * things that go wrong here - a stray write to stdout, a flag that never reaches the handlers,
 * a process that outlives its client - do not reproduce on an in-memory transport.
 */

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cli-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A client attached to `node src/index.js <args>` over stdio. */
async function connect(t, args = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, ...args],
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

const text = (result) => result.content[0].text;

test("over stdio the server lists its tools and answers a call", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);
  writeFileSync(join(dir, "a.txt"), "x");

  const { tools } = await client.listTools();
  const result = await client.callTool({ name: "list_directory", arguments: { path: dir } });

  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "create_github_repo",
    "create_gitlab_repo",
    "list_directory",
    "read_file",
    "run_command",
  ]);
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent.entries.map((e) => e.name), ["a.txt"]);
});

test("--confine reaches the handlers", async (t) => {
  const parent = scratch(t);
  const root = join(parent, "root");
  mkdirSync(root);
  const client = await connect(t, ["--confine", root]);

  const inside = await client.callTool({ name: "list_directory", arguments: { path: root } });
  const outside = await client.callTool({ name: "list_directory", arguments: { path: parent } });

  assert.equal(inside.isError, false);
  assert.equal(outside.isError, true);
  assert.match(text(outside), /outside the allowed root/);
});

test("--allow reaches the handlers", async (t) => {
  const dir = scratch(t);
  const client = await connect(t, ["--allow", "git, NPM"]);

  const refused = await client.callTool({
    name: "run_command",
    arguments: { path: dir, cmd: `"${process.execPath}" -v` },
  });

  assert.equal(refused.isError, true);
  assert.match(text(refused), /not in the allowlist\. Allowed: git, npm\./);
});

test("--timeout becomes the default for a call that names none", async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "hang.js"), "setInterval(() => {}, 1000);");
  const client = await connect(t, ["--timeout", "1"]);

  const result = await client.callTool({
    name: "run_command",
    arguments: { path: dir, cmd: `"${process.execPath}" hang.js` },
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.timed_out, true);
});

test("a bad command line exits 2 with the reason on stderr and nothing on stdout", () => {
  for (const args of [["--bogus"], ["--timeout", "abc"], ["--timeout", "0"], ["--timeout", "-3"], ["stray"]]) {
    const run = spawnSync(process.execPath, [ENTRY, ...args], { encoding: "utf8" });

    assert.equal(run.status, 2, args.join(" "));
    assert.equal(run.stdout, "", `${args.join(" ")} wrote to stdout`);
    assert.match(run.stderr, /Usage: node src\/index\.js/);
  }
});

test("--help prints the usage to stderr, leaves stdout empty and exits 0", () => {
  const run = spawnSync(process.execPath, [ENTRY, "--help"], { encoding: "utf8" });

  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /--confine DIR/);
});

test("the process exits by itself when its client goes away", async () => {
  const child = spawn(process.execPath, [ENTRY], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));

  child.stdin.end();

  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve("still running"), 5000)),
  ]);
  if (code === "still running") child.kill("SIGKILL");
  assert.equal(code, 0);
});
