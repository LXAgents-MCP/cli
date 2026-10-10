# Host CLI MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides an LLM (like Claude) with access to your local command line and file system.

By default, it allows free-form shell execution and unrestricted file access, making it a powerful tool for local development, scripting, and file management directly from your AI assistant.

**Local only, on purpose.** This server speaks MCP over stdio and nothing else: the client starts it as a subprocess on your machine and talks to it through a pipe. There is no HTTP transport and no network listener, and none should be added - a server that runs arbitrary commands must never be reachable from a network. The only network traffic is outbound, and only when you call one of the two repository tools: the server then makes an HTTPS request to GitHub or GitLab.

## Features

This server provides the following core tools to the LLM:
* **`run_command`**: Execute arbitrary shell commands (e.g., `node main.js`, `npm run build`, `git status`) with proper timeout management and process tree cleanup.
* **`read_file`**: Safely read local text files with automatic encoding handling and size truncation.
* **`list_directory`**: Explore the local file system with type markers (file/dir) and size tracking.
* **`create_github_repo`**: Create a new repository on GitHub, in your own account or in an organization. See [Repository tools](#repository-tools).
* **`create_gitlab_repo`**: Create a new repository on GitLab.com, in your own namespace or in a group. See [Repository tools](#repository-tools).

*Note: Tools are dynamically discovered from the `src/tools/` directory. You can add a tool by creating a new file there that exports `TOOL` (its name, description and schemas) and `handle(args)`.*

## Security & Confinement

Because this server allows shell execution, it runs exactly what the LLM tells it to. You can restrict the server's boundaries using command-line arguments:

* `--confine <DIR>`: Restricts the AI so it can only read files and run commands within the specified `<DIR>`. Traversal outside this root, including through symlinks, is rejected. This bounds where a command *starts*, not where it can go: a shell command can still reach any path it names.
* `--allow <executables>`: A comma-separated list of allowed executable commands (e.g., `node,git,npm`). If left empty (the default), any executable is allowed. This narrows what is run; it is not a boundary, because a shell line can build its executable in many ways.
* `--timeout <seconds>`: The default timeout for a command that does not ask for one (30 seconds if unset). A call may ask for longer, up to a fixed ceiling of 600 seconds.

These flags govern the three host tools. `create_github_repo` and `create_gitlab_repo` read no files and run no commands, so `--confine` and `--allow` do not apply to them; what they can do is bounded by the token you give them.

## Installation

Requires [Node.js](https://nodejs.org/) 20 or newer.

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/LXAgents-MCP/cli
   cd cli
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```

## Configuration (Claude Desktop)

To use this server with Claude Desktop, add it to your `claude_desktop_config.json` file.

**Path to config file:**
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following configuration, replacing the absolute path with the actual location of `src/index.js` on your machine:

```json
{
  "mcpServers": {
    "host-cli": {
      "command": "node",
      "args": [
        "C:/Absolute/Path/To/Your/Project/cli/src/index.js"
      ]
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
      "command": "node",
      "args": [
        "C:/Absolute/Path/To/Your/Project/cli/src/index.js",
        "--confine", "C:/Projects/SafeWorkspace",
        "--allow", "node,npm,git"
      ]
    }
  }
}
```

## Repository tools

`create_github_repo` and `create_gitlab_repo` create a new repository and return its URL and clone URL. Each reads its token from an environment variable of the server process, never from an argument, so the token does not appear in a prompt or a transcript.

| Tool | Environment variable | The token needs |
|---|---|---|
| `create_github_repo` | `LXAGENTS_MCP_GITHUB_API_KEY` | A classic personal access token with the `repo` scope. A fine-grained token works only where GitHub lets it create repositories; on a 403, use a classic token. |
| `create_gitlab_repo` | `LXAGENTS_MCP_GITLAB_API_KEY` | A personal access token with the `api` scope, whose owner may create projects where you ask. |

Set them in the `env` block of the server's entry in the client configuration, then restart the client:

```json
{
  "mcpServers": {
    "host-cli": {
      "command": "node",
      "args": ["C:/Absolute/Path/To/Your/Project/cli/src/index.js"],
      "env": {
        "LXAGENTS_MCP_GITHUB_API_KEY": "<your GitHub token>",
        "LXAGENTS_MCP_GITLAB_API_KEY": "<your GitLab token>"
      }
    }
  }
}
```

You need only the variable for the host you use. A tool whose variable is missing refuses with a message that names it; the server and its other tools are unaffected.

| | `create_github_repo` | `create_gitlab_repo` |
|---|---|---|
| Name | `name` (required) | `name` (required) |
| Where | `org`; omit it for the token owner's account | `group`, the full path such as `team/sub`; omit it for the token owner's namespace |
| Description | `description` | `description` |
| Visibility | `private`, default `true` | `visibility`: `private` (default), `internal` or `public` |
| Initial README | `auto_init`, default `true` | `initialize_with_readme`, default `true` |

A repository is private unless you ask for a public one. GitLab means gitlab.com; a self-hosted instance is not supported. The tools only create: they do not clone, push to, change or delete a repository.

## Usage

After updating the configuration, **restart Claude Desktop**. You should now see tools like `run_command`, `list_directory`, and `read_file` available. You can simply ask Claude to:
* *"List the files in my current directory."*
* *"Run the script located at C:\Projects\script.js"*
* *"Read my config.json file."*
* *"Create a private GitHub repository called my-new-repo in the LXAgents-MCP organization."*
* *"Create a GitLab repository called my-new-repo in my personal namespace."*

## Development

```bash
npm test          # the whole suite
npm run inspect   # drive the server by hand with the MCP Inspector
```

Nothing in `src/` may write to stdout: on stdio, stdout is the protocol channel. Diagnostics go to stderr.

## Moving from the Python version

The server was rewritten in JavaScript with the same three tools, schemas, flags and limits. To switch, change `"command": "python"` to `"command": "node"` and point `args` at `src/index.js` instead of `server.py`, then run `npm install` once. Two behaviours differ on purpose: a command's stdin is now closed instead of inherited from the server, and a timeout kills the whole process tree on macOS and Linux as well as on Windows.
