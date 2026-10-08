"""Expose the host command line to Claude over MCP.

Claude's sandbox cannot reach the shell, so this server runs *outside* it - spawned
by the MCP client as an ordinary host subprocess - and runs commands on the owner's
behalf. Register it in `claude_desktop_config.json`:

    {"mcpServers": {"cli": {"command": "<python>", "args": ["<this file>"]}}}

Then restart Claude Desktop.

The boundary, stated plainly: there isn't one by default. `path` is required on
every tool and may name any directory on the machine, and `cmd` is a free-form
shell string, so a command runs wherever it is told to. Nothing here is hardcoded
to a particular project - the server has no opinion about where your code lives.

What remains configurable is not a boundary but a *policy*: `--confine <dir>` refuses
any `path` that resolves outside <dir>, and `--allow` narrows which executable may
run at all. Both are off, because the owner asked for free host access.

Lifetime: the process lives until its stdin closes or the client goes away. The read
loop below blocks on stdin indefinitely and no timer can end it - a command that
outlives its timeout is reported as a timeout and the server carries on serving.
If you see a transport close after a long idle, the cause is on the other end of
the pipe, not here.

Layout:
    config.py            every knob, in one place
    tools/common.py      shared helpers; nothing here writes to stdout
    tools/<name>.py      one module per tool: TOOL schema + handle()
    server.py            this file - protocol and process lifetime only
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import config
import tools
from tools.common import Refused

# --------------------------------------------------------------------------
# Diagnostics - stderr, always
# --------------------------------------------------------------------------
# stdout is the protocol channel. One stray print() corrupts the stream and the client
# reports a JSON parse error that points at the payload rather than at the logging, which is
# the single most common way a stdio MCP server fails. Nothing in this file writes to stdout
# except the one function that writes a reply.

def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)

def reply(message: dict) -> None:
    """The only function permitted to write to stdout."""
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()

# --------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------

def tool_result(payload: dict, ok: bool, message: str = "") -> dict:
    """Shape a handler's payload into a `tools/call` result.

    `isError` is how a client learns a command failed. It carries the message, so a failure
    arrives as readable data rather than as an opaque protocol error.

    The text block is what the model actually reads, so it is rendered per tool shape: a
    command gets its two streams, a listing gets the entries, a refusal gets the sentence
    explaining it. Everything also rides along in `structuredContent` for a client that would
    rather read it programmatically.
    """
    payload = dict(payload)
    summary = payload.pop("summary", "")

    if message:
        # A refusal or a handler bug: there is nothing to render but the reason.
        body = f"**{summary or 'Refused'}**\n\n{message}"
    elif "stdout" in payload:
        body = f"**{summary}**\n\n"
        if payload.get("stdout"):
            body += f"```\n{payload['stdout']}\n```\n"
        if payload.get("stderr"):
            body += f"\n**stderr**\n\n```\n{payload['stderr']}\n```\n"
        if not payload.get("stdout") and not payload.get("stderr"):
            body += "_(no output)_\n"
    elif "entries" in payload:
        lines = "\n".join(
            f"- `{e['name']}`" + ("/" if e["type"] == "dir" else f"  ({e['size']} bytes)")
            for e in payload["entries"]
        )
        body = f"**{summary}**\n\n{lines or '_(empty)_'}"
    elif "content" in payload:
        body = f"**{
