import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../src/config/config.js";
import { createServer, toolResult } from "../src/routes/server.js";
import { get } from "../src/controllers/index.js";
import { SERVER_NAME, VERSION } from "../src/config/version.js";

/** A client connected to a fresh server over an in-memory pipe. */
async function connect(t: TestContext): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  const server = createServer();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function scratch(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cli-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The single text block of a result, which is what the model reads. */
const text = (result: unknown): string => {
  const { content } = result as CallToolResult;
  assert.equal(content.length, 1, "expected exactly one content block");
  const [block] = content;
  assert.ok(block !== undefined && block.type === "text", "expected a text block");
  return block.text;
};

/** The structured content of a result, read as plain fields. */
const fields = (result: unknown): Record<string, any> =>
  (result as CallToolResult).structuredContent as Record<string, any>;

test("the server identifies itself", async (t) => {
  const client = await connect(t);

  assert.deepEqual(client.getServerVersion(), { name: SERVER_NAME, version: VERSION });
  assert.deepEqual(Object.keys(client.getServerCapabilities() ?? {}), ["tools"]);
});

test("tools/list advertises the three tools with their schemas and hints", async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  const byName: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

  assert.deepEqual(Object.keys(byName).sort(), ["list_directory", "read_file", "run_command"]);

  assert.deepEqual(byName.run_command?.inputSchema.required?.sort(), ["cmd", "path"]);
  assert.deepEqual(byName.read_file?.inputSchema.required, ["path"]);
  assert.deepEqual(byName.list_directory?.inputSchema.required, ["path"]);

  assert.equal(byName.read_file?.annotations?.readOnlyHint, true);
  assert.equal(byName.list_directory?.annotations?.readOnlyHint, true);
  assert.equal(byName.run_command?.annotations?.destructiveHint, true);
  assert.equal(byName.run_command?.annotations?.openWorldHint, true);

  for (const tool of tools) {
    assert.equal(tool.outputSchema?.type, "object", `${tool.name} has no output schema`);
    assert.ok((tool.description ?? "").length > 20);
  }
});

test("list_directory over the protocol renders entries and structured content", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "a.txt"), "abc");

  const result = await client.callTool({ name: "list_directory", arguments: { path: dir } });

  assert.equal(result.isError, false);
  assert.match(text(result), /^\*\*2 entries in .+\.\*\*\n\n- `sub`\/\n- `a\.txt` {2}\(3 bytes\)$/);
  assert.deepEqual(fields(result).entries.map((e: { name: string }) => e.name), ["sub", "a.txt"]);
});

test("read_file over the protocol renders the content in a fenced block", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);
  writeFileSync(join(dir, "a.txt"), "hello");

  const result = await client.callTool({ name: "read_file", arguments: { path: join(dir, "a.txt") } });

  assert.equal(result.isError, false);
  assert.match(text(result), /```text\nhello\n```/);
  assert.equal(fields(result).bytes_read, 5);
});

test("run_command over the protocol renders both streams", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);
  writeFileSync(join(dir, "s.js"), "console.log('out'); console.error('err');");

  const result = await client.callTool({
    name: "run_command",
    arguments: { path: dir, cmd: `"${process.execPath}" s.js` },
  });

  assert.equal(result.isError, false);
  assert.match(text(result), /^\*\*Exited 0 in \d+ms\.\*\*\n\n```\nout\n\n```\n\n\*\*stderr\*\*\n\n```\nerr\n\n```\n$/);
  assert.equal(fields(result).exit_code, 0);
});

test("a failing command is an error result that still carries its output", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);
  writeFileSync(join(dir, "f.js"), "console.log('why'); process.exit(2);");

  // The client validates structuredContent against the output schema, so this resolving at all
  // shows the failure's payload is valid.
  const result = await client.callTool({
    name: "run_command",
    arguments: { path: dir, cmd: `"${process.execPath}" f.js` },
  });

  assert.equal(result.isError, true);
  assert.equal(fields(result).exit_code, 2);
  assert.match(text(result), /^\*\*Exited 2 in \d+ms\.\*\*/);
});

test("a refusal is an error result with the reason, and no structured content", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);

  // The client throws on structuredContent that does not match the output schema, so this
  // resolving is also the check that a refusal does not send an empty one.
  const result = await client.callTool({
    name: "list_directory",
    arguments: { path: join(dir, "nope") },
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.match(text(result), /^\*\*Refused\*\*\n\n`path` .+ does not exist\.$/);
});

test("confinement refuses a path outside the root over the protocol", async (t) => {
  const saved = config.confineRoot;
  t.after(() => {
    config.confineRoot = saved;
  });
  const client = await connect(t);
  const parent = scratch(t);
  const root = join(parent, "root");
  mkdirSync(root);
  config.confineRoot = root;

  const inside = await client.callTool({ name: "list_directory", arguments: { path: root } });
  const outside = await client.callTool({ name: "list_directory", arguments: { path: parent } });

  assert.equal(inside.isError, false);
  assert.equal(outside.isError, true);
  assert.match(text(outside), /outside the allowed root/);
});

test("a call with no path, or to no such tool, is an error result and not a crash", async (t) => {
  const client = await connect(t);

  const noPath = await client.callTool({ name: "read_file", arguments: {} });
  assert.equal(noPath.isError, true);
  assert.match(text(noPath), /path/);

  const unknown = await client.callTool({ name: "no_such_tool", arguments: {} });
  assert.equal(unknown.isError, true);
  assert.match(text(unknown), /not found/i);

  // The server is still serving.
  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
});

test("a handler that crashes is reported as an internal error and the server carries on", async (t) => {
  const client = await connect(t);
  const dir = scratch(t);
  const spec = get("list_directory");
  assert.ok(spec !== undefined, "list_directory is registered");
  const original = spec.handle;
  spec.handle = async () => {
    throw new TypeError("boom");
  };
  t.after(() => {
    spec.handle = original;
  });
  const written = t.mock.method(process.stderr, "write", () => true);

  const result = await client.callTool({ name: "list_directory", arguments: { path: dir } });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.equal(text(result), "**Internal Error**\n\nTypeError: boom");
  assert.match(String(written.mock.calls[0]?.arguments[0]), /^Handler crashed:\nTypeError: boom/);

  spec.handle = original;
  const after = await client.callTool({ name: "list_directory", arguments: { path: dir } });
  assert.equal(after.isError, false);
});

test("toolResult renders each payload shape", () => {
  assert.equal(
    text(toolResult({ summary: "S", stdout: "", stderr: "" }, true)),
    "**S**\n\n_(no output)_\n",
  );
  assert.equal(
    text(toolResult({ summary: "S", entries: [] }, true)),
    "**S**\n\n_(empty)_",
  );
  assert.equal(text(toolResult({ summary: "S" }, true)), "**S**");
  assert.equal(
    text(toolResult({ summary: "Boom" }, false, "why")),
    "**Boom**\n\nwhy",
  );
  assert.equal(text(toolResult({}, false, "why")), "**Refused**\n\nwhy");
});
