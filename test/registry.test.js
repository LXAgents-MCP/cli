import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { REGISTRY, TOOLS, discoverTools, get } from "../src/tools/index.js";

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "tools");

test("the three host tools are discovered, in name order", () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ["list_directory", "read_file", "run_command"],
  );
  assert.equal(get("read_file").name, "read_file");
  assert.equal(get("nope"), undefined);
});

test("every tool module is a tool and every tool is a module", () => {
  // The helpers live beside the tools and are not callable. Anything else in the directory is
  // a tool, and its file name is its tool name in kebab case.
  const files = readdirSync(TOOLS_DIR)
    .filter((file) => file.endsWith(".js") && !["index.js", "common.js"].includes(file))
    .map((file) => file.replace(/\.js$/, "").replaceAll("-", "_"))
    .sort();

  assert.deepEqual([...REGISTRY.keys()].sort(), files);
});

test("every tool carries a description, a required path, an output schema and annotations", () => {
  for (const { TOOL } of TOOLS) {
    assert.ok(TOOL.description.length > 20, `${TOOL.name} has no useful description`);
    assert.ok("path" in TOOL.inputSchema, `${TOOL.name} takes no path`);
    assert.ok(Object.keys(TOOL.outputSchema).length > 0, `${TOOL.name} has no output schema`);
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof TOOL.annotations[hint], "boolean", `${TOOL.name} lacks ${hint}`);
    }
  }
});

test("only run_command is allowed to change anything", () => {
  const writers = TOOLS.filter(({ TOOL }) => !TOOL.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(writers, ["run_command"]);
});

/** A directory of tool-shaped fixture modules, removed when the test ends. */
function fixtures(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "cli-registry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

const tool = (name) =>
  `export const TOOL = { name: ${JSON.stringify(name)} };\nexport async function handle() {}\n`;

test("discovery skips a module that is not a tool", async (t) => {
  const dir = fixtures(t, { "a.js": tool("alpha"), "helper.js": "export const value = 1;\n" });

  const found = await discoverTools(dir);
  assert.deepEqual([...found.keys()], ["alpha"]);
});

test("discovery refuses two tools with one name", async (t) => {
  const dir = fixtures(t, { "a.js": tool("same"), "b.js": tool("same") });

  await assert.rejects(discoverTools(dir), /Duplicate tool name 'same' in b\.js/);
});

test("discovery refuses a tool with no name", async (t) => {
  const dir = fixtures(t, { "a.js": tool("") });

  await assert.rejects(discoverTools(dir), /a\.js TOOL has no 'name'/);
});
