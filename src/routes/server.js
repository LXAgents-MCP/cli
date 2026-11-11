/**
 * The MCP server: protocol and tool dispatch only.
 *
 * A fresh instance is created per connection because McpServer holds per-connection state.
 * The tool surface is not written here - it is whatever `src/controllers/` discovers.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS } from "../controllers/index.js";
import { SERVER_NAME, VERSION } from "../config/version.js";
import { Refused } from "../utils/errors.js";
import { log } from "../utils/log.js";
import { renderResult } from "../utils/render.js";

/**
 * Shape a handler's payload into a `tools/call` result.
 *
 * `isError` is how a client learns a command failed. It carries the message, so a failure
 * arrives as readable data rather than as an opaque protocol error.
 *
 * The text block is what the model actually reads (see `src/utils/render.js`). Everything also
 * rides along in `structuredContent` for a client that would rather read it programmatically -
 * except on a refusal or a crash, which have no fields to report. A client validates
 * `structuredContent` against the tool's output schema whenever it is present, so an empty
 * object there would be rejected for the fields it lacks.
 *
 * @param {Record<string, unknown>} payload
 * @param {boolean} ok
 * @param {string} [message]
 */
export function toolResult(payload, ok, message = "") {
  const { summary = "", ...fields } = payload;
  const body = renderResult(summary, fields, message);

  const result = { content: [{ type: "text", text: body }], isError: !ok };
  if (!message) result.structuredContent = fields;
  return result;
}

/**
 * Run one tool call, turning every failure into a result the client can read.
 *
 * @param {import("../controllers/index.js").ToolSpec} spec
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
