# Host CLI MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides an LLM (like Claude) with access to your local command line and file system.

By default, it allows free-form shell execution and unrestricted file access, making it a powerful tool for local development, scripting, and file management directly from your AI assistant.

**Local only, on purpose.** This server speaks MCP over stdio and nothing else: the client starts it as a subprocess on your machine and talks to it through a pipe. There is no HTTP transport and no network listener, and none should be added - a server that runs arbitrary commands must never be reachable from a network.

## Features

This server provides the following core tools to the LLM:
* **`run_command`**: Execute arbitrary shell commands (e.g., `node main.js`, `npm run build`, `git status`) with proper timeout management and process tree cleanup.
* **`read_file`**: Safely read local text files with automatic encoding handling and size truncation.
* **`list_directory`**: Explore the local file system with type markers (file/dir) and size tracking.

**Repository tools moved.** `create_github_repo` and `create_gitlab_repo`, added in 2.1.0, are gone as of 3.0.0. GitHub and GitLab each have their own server now, [`lxagents-github`](https://github.com/LXAgents-MCP/github) and [`lxagents-gitlab`](https://github.com/LXAgents-MCP/gitlab), whose `repo_create` takes the same arguments and is one of 45 tools each. This server makes no network request.

*Note: Each tool is one Rust module in `src/controllers/`, named after the tool, exposing `spec()` (its definition and handler, typed by `src/models/tool.rs`). To add a tool, add the file and list its `spec` in `MODULES` in `src/controllers/mod.rs`; a test fails if a file there is left out.*

## Security & Confinement

Because this server allows shell execution, it runs exactly what the LLM tells it to. You can restrict the server's boundaries using command-line arguments:

* `--confine <DIR>`: Restricts the AI so it can only read files and run commands within the specified `<DIR>`. Traversal outside this root, including through symlinks, is rejected. This bounds where a command *starts*, not where it can go: a shell command can still reach any path it names.
* `--allow <executables>`: A comma-separated list of allowed executable commands (e.g., `node,git,npm`). If left empty (the default), any executable is allowed. This narrows what is run; it is not a boundary, because a shell line can build its executable in many ways.
* `--timeout <seconds>`: The default timeout for a command that does not ask for one (30 seconds if unset). A call may ask for longer, up to a fixed ceiling of 600 seconds.

## Installation

Requires a [Rust toolchain](https://rustup.rs/) 1.89 or newer. Nothing else is needed at run time: the server is a single native binary.

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/LXAgents-MCP/cli
   cd cli
   ```
2. Build the release binary:
   ```bash
   cargo build --release
   ```
   It is written to `target/release/lxagents-cli` (`lxagents-cli.exe` on Windows). After pulling a change, run `cargo build --release` again.

   Alternatively, `cargo install --path .` copies it to `~/.cargo/bin`, which is usually on your `PATH`.

## Configuration (Claude Desktop)

To use this server with Claude Desktop, add it to your `claude_desktop_config.json` file.

**Path to config file:**
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following configuration, replacing the absolute path with the actual location of the binary on your machine:

```json
{
  "mcpServers": {
    "host-cli": {
      "command": "C:/Absolute/Path/To/Your/Project/cli/target/release/lxagents-cli.exe"
    }
  }
}
```

### Example: Configured with Restrictions

If you want to sandbox the CLI tools to a specific workspace and allow only specific commands:

```json
{
  "mcpServers": {
    "host-cli": {
      "command": "C:/Absolute/Path/To/Your/Project/cli/target/release/lxagents-cli.exe",
      "args": [
        "--confine", "C:/Projects/SafeWorkspace",
        "--allow", "node,npm,git"
      ]
    }
  }
}
```

## Usage

After updating the configuration, **restart Claude Desktop**. You should now see tools like `run_command`, `list_directory`, and `read_file` available. You can simply ask Claude to:
* *"List the files in my current directory."*
* *"Run the script located at C:\Projects\script.js"*
* *"Read my config.json file."*

## Development

The server is written in Rust on the official MCP Rust SDK, [`rmcp`](https://github.com/modelcontextprotocol/rust-sdk). It is a library (`src/lib.rs`) and a thin binary (`src/main.rs`), so the tests can build a server in-process.

```bash
cargo build --release                       # build target/release/lxagents-cli
cargo test                                  # unit, protocol and stdio tests
cargo clippy --all-targets -- -D warnings   # lint
cargo fmt --check                           # formatting
npx @modelcontextprotocol/inspector target/release/lxagents-cli   # drive it by hand
```

The unit tests sit beside the code they test. `tests/server.rs` speaks MCP to a server over an in-memory pipe, and `tests/stdio.rs` starts the built binary the way a client does. `tests/fixtures/tools-list.json` pins the advertised tool surface.

Nothing in the crate may write to stdout: on stdio, stdout is the protocol channel. Diagnostics go to stderr. `unsafe` code is forbidden.

`src/` keeps one job per file, in the same folders as `lxagents-github` and `lxagents-gitlab`. A folder
uses only the folders below it in this table:

| Folder | Holds |
|---|---|
| `src/main.rs` | The entry: reads the command line, builds the settings, serves stdio. |
| `src/routes/` | `server.rs`: the MCP server (`HostCli`) and tool dispatch. |
| `src/controllers/` | One module per tool (`spec`, `definition`, `handle`), and the registry in `mod.rs`. |
| `src/services/` | `paths.rs` (where a tool may act, `--confine`), `allowlist.rs` (`--allow`), `process.rs` (running a command and killing its tree). |
| `src/models/` | `args.rs` (reading typed arguments and the `timeout`), `tool.rs` (the types every tool module shares). |
| `src/utils/` | `errors.rs`, `log.rs`, `render.rs` (the text the model reads), `text.rs` (decoding and truncation). |
| `src/config/` | `settings.rs` (limits and the settings the flags change), `options.rs` (parsing the flags), `version.rs`. |

## Moving from 4.x

5.0.0 rewrote the server in Rust. Run `cargo build --release` once, then change the client configuration: `command` becomes the path to `target/release/lxagents-cli`, and `dist/index.js` comes out of `args` (keep any `--confine`, `--allow` or `--timeout` flags there). Restart the client. Node is no longer needed. The tools, schemas, flags and limits are unchanged; a wrong argument type is now refused with a sentence naming the argument instead of the SDK's input validation error.

## Moving from 3.x

Follow "Moving from 4.x": the only difference is that `args` names `src/index.js` instead of `dist/index.js`. That entry comes out the same way.

## Moving from the Python version

The server was rewritten in JavaScript, then TypeScript, then Rust, with the same three tools, schemas, flags and limits. To switch, build the binary as above and set `"command"` to its path instead of `"python"`, dropping `server.py` from `args`. Two behaviours differ on purpose: a command's stdin is now closed instead of inherited from the server, and a timeout kills the whole process tree on macOS and Linux as well as on Windows.
