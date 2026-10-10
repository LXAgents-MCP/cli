# 3.0.0

**Released:** 2026-10-10

**Breaking.** `create_github_repo` and `create_gitlab_repo`, added in 2.1.0, are removed. GitHub and
GitLab each have their own MCP server now, [`lxagents-github`](https://github.com/LXAgents-MCP/github)
and [`lxagents-gitlab`](https://github.com/LXAgents-MCP/gitlab), and the same tools are their
`repo_create`, with the same arguments and behaviour, among 45 tools each. This server goes back to
the three tools its name describes: `run_command`, `read_file` and `list_directory`, with their flags,
limits and refusal messages unchanged.

**The server is stdio only, with no network listener, and makes no network request.** The outbound
HTTPS requests that 2.1.0 added are gone with the tools that made them.

**Clients must:**

1. **If you call `create_github_repo` or `create_gitlab_repo`, call `repo_create` instead**, on
   `lxagents-github` or `lxagents-gitlab`. Register that server in the client configuration first: clone
   its repository, run `npm install` once, and point the client at `node src/index.js`. Each README
   says how. The arguments are the ones you already use: `name`, and `org` or `group`, `description`,
   `private` or `visibility`, and `auto_init` or `initialize_with_readme`.
2. **Move the token** (`LXAGENTS_MCP_GITHUB_API_KEY` or `LXAGENTS_MCP_GITLAB_API_KEY`) from this
   server's `env` block to the new server's, and delete it here. This server no longer reads it, but
   every command `run_command` starts inherits the server's environment, so a token left in this
   block is readable by any command the model runs.
3. **Restart the client**, so it reloads the connectors and lists the tools.

A client that never put a token in this server's `env` block has nothing to do beyond the restart.

## Removed

- **`create_github_repo` and `create_gitlab_repo`**, and the shared API client, token handling and
  result rendering that only they used.
- **Both environment variables.** They are no longer read. A token left in this server's `env` block
  does nothing for it, and is still passed on to every command it runs; delete it.

## Changed

- **The README** says where the repository tools went, and no longer says the server makes outbound
  requests.
- **Tests:** 57 under `node --test`, the number the suite had before the tools were added.

## Security

- **The server has no credentials to use.** Nothing in it reads a token. A token left in its `env`
  block is not used, yet it stays in the environment of every command `run_command` starts, which is
  the reason step 2 above says to delete it; this was already so in 2.1.0.
- **No outbound traffic.** With the API client gone, nothing under `src/` opens a connection.
- **The host tools are unchanged.** `--confine` and `--allow` still bound them as before, and
  neither is a guarantee against a shell line; see the README.
