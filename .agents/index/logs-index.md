---
name: logs-index
description: This repository's release history, newest first — what changed and what clients must do.
---

# Logs Index

**Scope:** `wiki/logs/`

A client picks up a change when it next starts the server, so the **Clients must** column is the
only notice it gets. It is never left blank.

## Versions

| Version | Date | Summary | Clients must |
|---|---|---|---|
| [`3/0/0`](../../wiki/logs/3/0/0/CHANGELOG.md) | 2026-10-10 | **Breaking: the repository tools are gone.** `create_github_repo` and `create_gitlab_repo` move to the `repo_create` tool of the new `lxagents-github` and `lxagents-gitlab` servers, which take the same arguments. This server is back to `run_command`, `read_file` and `list_directory`, and makes no network request. | **If you call either tool, register `lxagents-github` or `lxagents-gitlab`, move the token to its `env` block, call `repo_create`, and restart the client.** **Delete the token from this server's `env` block:** it is no longer read, but every command `run_command` starts still inherits it. Then restart the client. |
| [`2/1/0`](../../wiki/logs/2/1/0/CHANGELOG.md) | 2026-10-10 | **Two repository tools.** `create_github_repo` and `create_gitlab_repo` create a new repository on GitHub or GitLab.com, private by default, with the token read from `LXAGENTS_MCP_GITHUB_API_KEY` or `LXAGENTS_MCP_GITLAB_API_KEY`. The three host tools are unchanged. The server now makes outbound HTTPS requests when these tools are called, and still has no listener. | **Nothing, unless you want the new tools:** then add the token to the `env` block of the server's entry in the client configuration, and restart the client. |
| [`2/0/0`](../../wiki/logs/2/0/0/CHANGELOG.md) | 2026-10-09 | **Rewritten in JavaScript.** The same three tools, schemas, flags and limits, on Node 20 or newer instead of Python, with the MCP SDK as the protocol layer. Still stdio only. A timeout now kills the whole process tree on macOS and Linux, a command's stdin is closed, and a refusal no longer carries an empty `structuredContent`. | **Install Node 20+ and run `npm install` once; change `"command": "python"` to `"node"` and the path to `src/index.js`; restart the client.** The flags are unchanged. |

## Maintenance

* Newest version first, one row per version directory.
* A new version directory is a version claim and needs the owner's approval.
* Never edit a released log to change history; corrections go in the next version.
