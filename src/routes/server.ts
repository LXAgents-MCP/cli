/**
 * The MCP server: protocol and tool dispatch only.
 *
 * A fresh instance is created per connection because McpServer holds per-connection state.
 * The tool surface is not written here - it is whatever `src/controllers/` discovers.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, type ToolSpec } from "../controllers/index.js";
import { SERVER_NAME, VERSION } from "../config/version.js";
import type { ToolArgs, ToolPayload } from "../models/tool.js";
import { Refused } from "../utils/errors.js";
import { log } from "../utils/log.js";
import { renderResult } from "../utils/render.js";

/**
 * Shape a handler's payload into a `tools/call` result.
 *
 * `isError` is how a client learns a command failed. It carries the message, so a failure
 * arrives as readable data rather than as an opaque protocol error.
 *
 * The text block is what the model actually reads (see `src/utils/render.ts`). Everything also
 * rides along in `structuredContent` for a client that would rather read it programmatically -
 * except on a refusal or a crash, which have no fields to report. A client validates
 * `structuredContent` against the tool's output schema whenever it is present, so an empty
 * object there would be rejected for the fields it lacks.
 *
 * @param message The reason, for a refusal or a handler crash.
 */
export function toolResult(payload: ToolPayload, ok: boolean, message: string = ""): CallToolResult {
  const { summary = "", ...fields } = payload;
  const body = renderResult(summary, fields, message);

  const result: CallToolResult = { content: [{ type: "text", text: body }], isError: !ok };
  if (!message) result.structuredContent = fields;
  return result;
}

/** Run one tool call, turning every failure into a result the client can read. */
async function callTool(spec: ToolSpec, args: ToolArgs): Promise<CallToolResult> {
  try {
    const { payload, ok } = await spec.handle(args);
    return toolResult(payload, ok);
  } catch (error) {
    if (error instanceof Refused) {
      return toolResult({ summary: "Refused" }, false, error.message);
    }
    // Anything can be thrown, so read it as a possibly partial error.
    const crash = error as Partial<Error> | null | undefined;
    log(`Handler crashed:\n${crash?.stack ?? error}`);
    return toolResult(
      { summary: "Internal Error" },
      false,
      `${crash?.name ?? "Error"}: ${crash?.message ?? error}`,
    );
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  for (const spec of TOOLS) {
    const { description, inputSchema, outputSchema, annotations } = spec.TOOL;
    server.registerTool(
      spec.name,
      { description, inputSchema, outputSchema, annotations },
      (args: ToolArgs) => callTool(spec, args),
    );
  }

  return server;
}
