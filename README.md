# Host CLI MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides an LLM (like Claude) with access to your local command line and file system.

By default, it allows free-form shell execution and unrestricted file access, making it a powerful tool for local development, scripting, and file management directly from your AI assistant.

## Features

This server provides the following core tools to the LLM:
* **`run_command`**: Execute arbitrary shell commands (e.g., `python main.py`, `npm run build`, `git status`) with proper timeout management and process tree cleanup.
* **`read_file`**: Safely read local text files with automatic encoding handling and size truncation.
* **`list_directory`**: Explore the local file system with type markers (file/dir) and size tracking.

*Note: Tools are dynamically discovered from the `tools/` directory. You can add new tools by simply creating a new python file in the directory.*

## Security & Confinement

Because this server allows shell execution, it runs exactly what the LLM tells it to. You can restrict the server's boundaries using command-line arguments:

* `--confine <DIR>`: Restricts the AI so it can only read files and run commands within the specified `<DIR>`. Traversal outside this root is rejected.
* `--allow <executables>`: A comma-separated list of allowed executable commands (e.g., `python,git,npm`). If left empty (the default), any executable is allowed.
* `--timeout <seconds>`: Set a custom command execution timeout ceiling (default is 30 seconds).

## Installation

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/LXAgents-MCP/cli
   cd cli
   ```
2. No installation via `pip` is required! This project is built entirely on standard Python libraries.

## Configuration (Claude Desktop)

To use this server with Claude Desktop, add it to your `claude_desktop_config.json` file.

**Path to config file:**
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following configuration, replacing the absolute path with the actual location of the `server.py` file on your machine:

```json
{
  "mcpServers": {
    "host-cli": {
      "command": "python",
      "args": [
        "C:/Absolute/Path/To/Your/Project/cli/server.py"
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
      "command": "python",
      "args": [
        "C:/Absolute/Path/To/Your/Project/cli/server.py",
        "--confine", "C:/Projects/SafeWorkspace",
        "--allow", "python,npm,git"
      ]
    }
  }
}
```

## Usage

After updating the configuration, **restart Claude Desktop**. You should now see tools like `run_command`, `list_directory`, and `read_file` available. You can simply ask Claude to:
* *"List the files in my current directory."*
* *"Run the python script located at C:\Projects\script.py"*
* *"Read my config.json file."*
