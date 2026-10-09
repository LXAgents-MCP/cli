# 2.0.0

**Released:** 2026-10-09

The server is rewritten in JavaScript. It serves the same three tools — `run_command`,
`read_file` and `list_directory` — with the same schemas, flags, limits and refusal messages, but
it now runs on Node 20 or newer instead of Python. This is a major release because every client
has to change the command it uses to start the server.

**The server is still stdio only, on purpose.** It runs arbitrary commands, so it must be loaded
by the client on the same machine and never reached over a network. There is no HTTP transport and
no token to configure.

**Consumers must:**

1. **Install Node.js 20 or newer, and run `npm install` once in the checkout.** The Python version
   needed no install step; this one depends on the MCP SDK and zod.
2. **Change the client configuration.** `"command": "python"` becomes `"command": "node"`, and the
   path in `args` points at `src/index.js` instead of `server.py`. The flags `--confine`,
   `--allow` and `--timeout` are unchanged.
3. **Restart the client**, so it reloads the connector.
4. **Do not rely on the Python files.** `server.py`, `config.py` and `tools/` are gone.

## Added

- A Node package: `package.json` (private — the server gives shell access and is cloned, not
  published), a lockfile, and the scripts `start`, `test` and `inspect`.
- Tests: 57 under `node --test`, covering the path, allowlist, timeout, decoding and truncation
  helpers; each tool; the server over an in-memory client; and the real process over a stdio pipe.
  One starts a grandchild that holds the output pipes after a timeout and fails if the call waits
  on it.
- `--help`, which prints the usage to stderr.

## Changed

- **The protocol layer is the MCP SDK's**, in place of a hand-written JSON-RPC loop, so protocol
  versions are negotiated by the SDK.
- **A timeout kills the whole process tree on macOS and Linux**, through a process group, as it
  already did on Windows through `taskkill`.
- **A command's stdin is closed.** It used to be inherited from the server, whose stdin is the
  protocol channel, so a child could read the client's next message.
- **A missing or wrongly typed argument is rejected by the SDK's schema validation**, with the
  SDK's wording. Everything past that — an empty `path`, a missing directory, confinement, the
  allowlist — keeps the Python server's messages.
- **`read_file` on a missing file is a refusal**, not an internal error.
- **`list_directory` reports `truncated` only when entries were actually left out.** It used to
  report it for a directory of exactly 500.
- **The allowlist reads the first token of the command itself**, handling a quoted token and both
  path separators. The name compared is still the file stem, lowercased.
- **`--timeout` is described as what it is**: the default for a command that does not ask for one.
  The 600-second ceiling is fixed.
- The tool descriptions no longer name `cmd.exe` alone; the command runs through `/bin/sh` on
  macOS and Linux.

## Removed

- `server.py`, `config.py` and `tools/*.py`.

## Fixed

- **A refusal no longer carries an empty `structuredContent`.** A client validates it against the
  tool's output schema whenever it is present, so a strict client would have rejected every
  refusal. A failing command still carries its full output.
- **`--timeout 0` and a negative `--timeout`** are now a usage error. The Python server ignored
  `0` and accepted a negative value, which made every command time out at once.
