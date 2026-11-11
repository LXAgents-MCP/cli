/**
 * The shape every tool module shares: its MCP definition, the arguments its handler receives,
 * and the outcome the handler resolves to. Types only - nothing here runs.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

/** What `tools/list` advertises for a tool. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  outputSchema: ZodRawShape;
  annotations: ToolAnnotations;
}

/**
 * A call's arguments as the handler sees them. Every field is `unknown` on purpose: each handler
 * checks what it reads and refuses what it cannot use, rather than trusting the schema alone.
 */
export type ToolArgs = Readonly<Record<string, unknown>>;

/** What a handler returns: the fields to report, with a one-line summary for the model. */
export interface ToolPayload {
  summary?: string;
  [field: string]: unknown;
}

/**
 * A handler's result. `ok` false marks the call as an error without dropping its payload. A tool
 * names its own payload type, declared with `type` so it stays assignable to `ToolPayload`.
 */
export interface ToolOutcome<P extends ToolPayload = ToolPayload> {
  payload: P;
  ok: boolean;
}

export type ToolHandler = (args: ToolArgs) => Promise<ToolOutcome>;

/** A module in `src/controllers/` that is a tool. */
export interface ToolModule {
  TOOL: ToolDefinition;
  handle: ToolHandler;
}

/** A discovered tool, as the registry holds it. */
export interface ToolSpec extends ToolModule {
  name: string;
}
