/**
 * The MCP server: protocol and tool dispatch only.
 *
 * A fresh instance is created per connection because McpServer holds per-connection state.
 * The tool surface is not written here - it is whatever `src/tools/` discovers.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log } from "./log.js";
import { Refused } from "./tools/common.js";
import { TOOLS } from "./tools/index.js";
import { SERVER_NAME, VERSION } from "./version.js";

/**
 * Shape a handler's payload into a `tools/call` result.
 *
 * `isError` is how a client learns a command failed. It carries the message, so a failure
 * arrives as readable data rather than as an opaque protocol error.
 *
 * The text block is what the model actually reads, so it is rendered per tool shape: a command
 * gets its two streams, a listing gets the entries, a refusal gets the sentence explaining it.
 * Everything also rides along in `structuredContent` for a client that would rather read it
 * programmatically - except on a refusal or a crash, which have no fields to report. A client
 * validates `structuredContent` against the tool's output schema whenever it is present, so an
 * empty object there would be rejected for the fields it lacks.
 *
 * @param {Record<string, unknown>} payload
 * @param {boolean} ok
 * @param {string} [message]
 */
export function toolResult(payload, ok, message = "") {
  const { summary = "", ...fields } = payload;
  let body;

  if (message) {
    // A refusal or a handler bug: there is nothing to render but the reason.
    body = `**${summary || "Refused"}**\n\n${message}`;
  } else if ("stdout" in fields) {
    body = `**${summary}**\n\n`;
    if (fields.stdout) body += `\`\`\`\n${fields.stdout}\n\`\`\`\n`;
    if (fields.stderr) body += `\n**stderr**\n\n\`\`\`\n${fields.stderr}\n\`\`\`\n`;
    if (!fields.stdout && !fields.stderr) body += "_(no output)_\n";
  } else if ("entries" in fields) {
    const lines = fields.entries
      .map((e) => `- \`${e.name}\`` + (e.type === "dir" ? "/" : `  (${e.size} bytes)`))
      .join("\n");
    body = `**${summary}**\n\n${lines || "_(empty)_"}`;
  } else if ("content" in fields) {
    body = `**${summary}**\n\n\`\`\`text\n${fields.content}\n\`\`\`\n`;
  } else if ("html_url" in fields) {
    // A created repository: the URLs are the answer, so they go in the text the model reads.
    body = `**${summary}**\n\n- URL: ${fields.html_url}\n- Clone: ${fields.clone_url}`;
    if (fields.default_branch) body += `\n- Default branch: ${fields.default_branch}`;
  } else {
    body = `**${summary}**`;
  }

  const result = { content: [{ type: "text", text: body }], isError: !ok };
  if (!message) result.structuredContent = fields;
  return result;
}

/**
 * Run one tool call, turning every failure into a result the client can read.
 *
 * @param {import("./tools/index.js").ToolSpec} spec
 * @param {object} args
 */
async function callTool(spec, args) {
  try {
    const { payload, ok } = await spec.handle(args);
    return toolResult(payload, ok);
  } catch (error) {
    if (error instanceof Refused) {
      return toolResult({ summary: "Refused" }, false, error.message);
    }
    log(`Handler crashed:\n${error?.stack ?? error}`);
    return toolResult(
      { summary: "Internal Error" },
      false,
      `${error?.name ?? "Error"}: ${error?.message ?? error}`,
    );
  }
}

/** @returns {McpServer} */
export function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  for (const spec of TOOLS) {
    const { description, inputSchema, outputSchema, annotations } = spec.TOOL;
    server.registerTool(
      spec.name,
      { description, inputSchema, outputSchema, annotations },
      (args) => callTool(spec, args),
    );
  }

  return server;
}
