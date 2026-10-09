#!/usr/bin/env node
/*
 * Server entry point.
 *
 * Exposes the host command line to Claude over MCP. Claude's sandbox cannot reach the shell, so
 * this server runs *outside* it - spawned by the MCP client as an ordinary host subprocess - and
 * runs commands on the owner's behalf. Register it in `claude_desktop_config.json`:
 *
 *   {"mcpServers": {"cli": {"command": "node", "args": ["<this file>"]}}}
 *
 * The boundary, stated plainly: there isn't one by default. `path` is required on every tool and
 * may name any directory on the machine, and `cmd` is a free-form shell string, so a command runs
 * wherever it is told to. What remains configurable is not a boundary but a *policy*: --confine
 * refuses any `path` that resolves outside the given directory, and --allow narrows which
 * executable may run at all. Both are off, because the owner asked for free host access.
 *
 * Stdio is the only transport, on purpose. Free-form shell execution must never be reachable
 * over a network, so there is no HTTP transport here and no token to configure: the client
 * spawns this process and speaks to it over a pipe, which is as far as its reach goes.
 *
 * Lifetime: the process lives until its stdin closes or the client goes away. A command that
 * outlives its timeout is reported as a timeout and the server carries on serving.
 *
 * Nothing here may write to stdout: on stdio, stdout is the JSON-RPC channel.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./log.js";
import { USAGE, UsageError, applyOptions, parseOptions } from "./options.js";
import { createServer } from "./server.js";
import { SERVER_NAME, VERSION } from "./version.js";

let options;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  log(`${error.message}\n\n${USAGE}`);
  process.exit(2);
}

if (options.help) {
  log(USAGE);
  process.exit(0);
}

applyOptions(options);

const server = createServer();
await server.connect(new StdioServerTransport());
log(`${SERVER_NAME} ${VERSION} serving over stdio`);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
