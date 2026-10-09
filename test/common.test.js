import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_OUTPUT, MAX_TIMEOUT, config } from "../src/config.js";
import {
  Refused,
  checkAllowlist,
  clampTimeout,
  decode,
  firstToken,
  resolvePath,
  truncate,
} from "../src/tools/common.js";

/** A real, symlink-free scratch directory that is removed when the test ends. */
function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cli-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Restore the settings a test changed, whatever the test did. */
function resetConfig(t) {
  const saved = { ...config };
  t.after(() => Object.assign(config, saved));
}

test("resolvePath refuses a missing, empty or non-string path", () => {
  for (const raw of [undefined, null, "", "   "]) {
    assert.throws(() => resolvePath(raw), (e) => e instanceof Refused && /is required/.test(e.message));
  }
  assert.throws(() => resolvePath(5), /must be a string, got number/);
});

test("resolvePath resolves a relative path against the working directory", () => {
  assert.equal(resolvePath("."), realpathSync(process.cwd()));
});

test("resolvePath tells a missing path from a file from a directory", (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "a.txt"), "x");

  assert.equal(resolvePath(dir), dir);
  assert.throws(() => resolvePath(join(dir, "nope")), /does not exist/);
  assert.throws(() => resolvePath(join(dir, "a.txt")), /is a file, not a directory/);
  assert.equal(resolvePath(join(dir, "a.txt"), { mustBeDir: false }), join(dir, "a.txt"));
  assert.equal(resolvePath(join(dir, "nope"), { mustBeDir: false }), join(dir, "nope"));
});

test("confinement admits the root and what is inside it", (t) => {
  resetConfig(t);
  const root = scratch(t);
  mkdirSync(join(root, "sub"));
  config.confineRoot = root;

  assert.equal(resolvePath(root), root);
  assert.equal(resolvePath(join(root, "sub")), join(root, "sub"));
  assert.equal(resolvePath(join(root, "later"), { mustBeDir: false }), join(root, "later"));
});

test("confinement refuses traversal, a sibling that shares the prefix, and a path that is not there", (t) => {
  resetConfig(t);
  const parent = scratch(t);
  const root = join(parent, "root");
  mkdirSync(root);
  mkdirSync(join(root, "sub"));
  mkdirSync(join(parent, "root-evil"));
  config.confineRoot = root;

  for (const raw of [
    parent,
    join(root, ".."),
    join(root, "sub", "..", ".."),
    join(parent, "root-evil"),
    join(parent, "elsewhere"),
  ]) {
    assert.throws(
      () => resolvePath(raw, { mustBeDir: false }),
      (e) => e instanceof Refused && /outside the allowed root/.test(e.message),
      raw,
    );
  }
});

test("confinement refuses a symlink that leaves the root", { skip: process.platform === "win32" }, (t) => {
  resetConfig(t);
  const parent = scratch(t);
  const root = join(parent, "root");
  const outside = join(parent, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  symlinkSync(outside, join(root, "link"));
  config.confineRoot = root;

  assert.throws(() => resolvePath(join(root, "link")), /outside the allowed root/);
  // A path that does not exist yet, behind the same link, leaves the root just the same.
  assert.throws(() => resolvePath(join(root, "link", "new"), { mustBeDir: false }), /outside the allowed root/);
});

test("firstToken reads the executable the way the allowlist needs it", () => {
  const cases = [
    ["git status", "git"],
    ["  python3 -V", "python3"],
    ['"C:\\Tools\\Git.exe" status', "git"],
    ["C:/tools/NPM.cmd run build", "npm"],
    ["'my tool' --flag", "my tool"],
    ['"unterminated', "unterminated"],
    ["", ""],
  ];
  for (const [command, expected] of cases) assert.equal(firstToken(command), expected, command);
});

test("checkAllowlist is off when empty and narrows when populated", (t) => {
  resetConfig(t);

  config.allowedExecutables = [];
  checkAllowlist("anything at all");

  config.allowedExecutables = ["git", "npm"];
  checkAllowlist("git status");
  assert.throws(
    () => checkAllowlist("python main.py"),
    (e) =>
      e instanceof Refused &&
      e.message === "`cmd` starts with 'python', which is not in the allowlist. Allowed: git, npm.",
  );
});

test("clampTimeout falls back to the default and stays inside the ceiling", (t) => {
  resetConfig(t);
  config.defaultTimeout = 12;

  assert.equal(clampTimeout(undefined), 12);
  assert.equal(clampTimeout(null), 12);
  assert.equal(clampTimeout("abc"), 12);
  assert.equal(clampTimeout(5), 5);
  assert.equal(clampTimeout("7"), 7);
  assert.equal(clampTimeout(0), 1);
  assert.equal(clampTimeout(1e6), MAX_TIMEOUT);
});

test("decode reads UTF-8, falls back to Windows-1252, and leaves the BOM to the caller", () => {
  assert.equal(decode(Buffer.from("héllo", "utf8")), "héllo");
  assert.equal(decode(Buffer.from([0x63, 0x61, 0x66, 0xe9])), "café");
  assert.equal(decode(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), "\uFEFFa");
});

test("truncate cuts at the output ceiling and says so", () => {
  assert.deepEqual(truncate("short"), ["short", false]);

  const [cut, truncated] = truncate("x".repeat(MAX_OUTPUT + 1));
  assert.equal(truncated, true);
  assert.equal(cut, `${"x".repeat(MAX_OUTPUT)}\n... (truncated)`);
  assert.deepEqual(truncate("x".repeat(MAX_OUTPUT))[1], false);
});
