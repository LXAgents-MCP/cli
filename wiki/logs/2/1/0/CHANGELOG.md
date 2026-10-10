# 2.1.0

**Released:** 2026-10-10

The server gains two tools, `create_github_repo` and `create_gitlab_repo`, that create a new
repository on GitHub or on GitLab.com. Each reads its token from an environment variable of the
server process. The three host tools — `run_command`, `read_file` and `list_directory` — are
unchanged, and so are the flags, limits and refusal messages, so a client that does not want the
new tools has nothing to do.

**The server is still stdio only, with no network listener.** What changes is that it now also
makes outbound HTTPS requests, to `api.github.com` or `gitlab.com`, and only when one of the two
new tools is called.

**Consumers must, to use the new tools:**

1. **Create a token** for each host you use. For GitHub, a classic personal access token with the
   `repo` scope; for GitLab, a personal access token with the `api` scope.
2. **Add the token to the `env` block** of this server's entry in the client configuration, as
   `LXAGENTS_MCP_GITHUB_API_KEY` or `LXAGENTS_MCP_GITLAB_API_KEY`.
3. **Restart the client**, so it reloads the connector and lists the new tools.

A tool whose variable is missing refuses with a message naming it; nothing else is affected.

## Added

- **`create_github_repo`**: `name`, and optionally `org`, `description`, `private` and
  `auto_init`. It creates the repository in the token owner's account, or in the organization
  named by `org`, and returns its name, full name, URL, clone URL, visibility and default branch.
- **`create_gitlab_repo`**: `name`, and optionally `group`, `description`, `visibility` and
  `initialize_with_readme`. It creates the project in the token owner's namespace, or in the group
  named by its full path, and returns the same fields.
- Both create a **private** repository with an initial README unless told otherwise.
- Both turn a failure into a message that names the next step: a rejected token, a missing
  permission, an unknown organization or group, a name that is already taken, a network failure or
  a timeout after 30 seconds.
- Tests: 105 under `node --test`, up from 57, none of which touches the network.

## Changed

- **A result that creates a repository shows its URLs in the text the model reads**, as well as in
  `structuredContent`.
- The README documents the new tools, the two environment variables and the `env` block, and says
  that `--confine` and `--allow` do not apply to them.

## Security

- **The token is read from the environment at call time.** It is never an argument, so it does not
  appear in a prompt or a transcript, and a server without a token still starts.
- **The token is never logged or returned.** It is removed from any error text before the text is
  shown.
- **The tools only create.** They never clone, push to, change or delete a repository.
- **`--confine` and `--allow` do not bound these tools**, because they read no files and run no
  commands. What they can do is bounded by the token: give it only the scope it needs.
