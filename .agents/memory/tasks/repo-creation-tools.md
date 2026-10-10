---
name: memory-tasks-repo-creation-tools
description: Adding create_github_repo and create_gitlab_repo to the cli MCP server, with tokens read from the environment, released as 2.1.0.
---

# Repository creation tools

## 2026-10-10 — in progress

**Goal.** An LLM connected to the host CLI MCP server can create a new repository on GitHub and
on GitLab, without the owner pasting a token into a prompt.

**Objective.** `node src/index.js` serves two more tools, `create_github_repo` and
`create_gitlab_repo`. Each reads its token from the environment
(`LXAGENTS_MCP_GITHUB_API_KEY`, `LXAGENTS_MCP_GITLAB_API_KEY`), creates the repository in the
owner's personal account or in an organization or group, and returns its URL. A missing token is
a readable refusal, never a crash. `npm test` is green and no test touches the network.

**Detail.** Edit this repository only. No new dependency: the tools use Node's built-in `fetch`.
The server stays stdio-only, with no network listener; it now also makes outbound HTTPS calls,
and the README and the changelog say so. The token is read at call time, is never logged and is
never returned. GitLab targets gitlab.com only.

**Status:** in progress.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `chore/repo-creation-tools-plan` | |
| 2 | `create_github_repo` | `feat/github-repo` | |
| 3 | `create_gitlab_repo` | `feat/gitlab-repo` | |
| 4 | Release | `release/2.1.0` | |

Branches stack: task 1 from `master`, task `k` from task `k-1`. The `PR` column is filled by
task 4, once the pull requests exist.

## Decisions the owner approved with the plan

| # | Decision |
|---|---|
| D1 | Both tools default to a private repository. The owner passes `private: false` (GitHub) or `visibility: "public"` (GitLab) to make one public. |
| D2 | The release is `2.1.0`: new tools, nothing breaks for an existing client. No git tag is created without its own approval. |
| D3 | GitLab means gitlab.com. A self-hosted URL would need a third environment variable and is left out. |
| D4 | `core.autocrlf` is set to `true` in this checkout, so the CRLF working tree reads as clean and stacked branches switch without false conflicts. It is local configuration, not a commit. |
| D5 | Four branches, the first being the task record, as the workflow asks. |

## Task entries

### Task 1 — chore/repo-creation-tools-plan

Landed: this record and its row in `memory-index.md`. Nothing outside `.agents/` changes in this
task. The `PR` column is filled by task 4, not here, so no later branch needs a rebase.

Baseline before any change: `npm test` ran 56 passing and 1 failing. The failing test is named in
the Task 2 entry below.

### Task 2 — feat/github-repo

Landed. `create_github_repo` takes `name`, and optionally `org`, `description`, `private` and
`auto_init`. It posts to `/user/repos`, or to `/orgs/{org}/repos` when `org` is given, with the
token from `LXAGENTS_MCP_GITHUB_API_KEY`. It creates a private repository with an initial README
unless told otherwise (D1). It returns `name`, `full_name`, `html_url`, `clone_url`, `visibility`
and, when GitHub reports one, `default_branch`.

Shared code the GitLab tool reuses, all in `src/tools/common.js`: `requireToken` (reads the
variable per call, so a server without a token still starts), `redact`, `optionalText`,
`optionalFlag`, and `callApi` (built-in `fetch`, a 30 s timeout from `API_TIMEOUT_MS` in
`config.js`, and every network failure turned into a refusal with the token scrubbed). `toolResult`
in `server.js` gained one branch: a payload with `html_url` renders the URLs in the text block,
because that text is what the model reads. The output field names (`html_url`, `clone_url`,
`visibility`, `default_branch`) are the ones the GitLab tool will also use.

Errors name the next step: 401 says the token was rejected, 403 says which permission the token
needs, 404 on an organization says it may not exist or be visible, 422 carries GitHub's reason
(usually a name already taken). An argument that is wrong is refused before the token is read or
anything is sent. No test touches the network: `fetch` is mocked.

The registry tests assumed three tools that all take a `path`; they now list four, check `path`
only on the three host tools, and allow `create_github_repo` to change things. Task 3 updates the
same assertions for the GitLab tool.

`npm test`: 85 tests, 84 passing. The one failure is `the process exits by itself when its client
goes away` in `test/stdio.test.js`. It fails the same way on an untouched copy of `master`, so it
is the baseline failure and not this task's: the spawned server is still running after its client
closes, in the environment the work was done in. It is left alone here and reported to the owner.

Left for task 3: the GitLab tool. Left for task 4: the version, the changelog, the README, and the
`PR` column.

### Task 3 — feat/gitlab-repo

Landed. `create_gitlab_repo` takes `name`, and optionally `group`, `description`, `visibility`
(`private`, `internal` or `public`) and `initialize_with_readme`. It posts to
`https://gitlab.com/api/v4/projects` with the token from `LXAGENTS_MCP_GITLAB_API_KEY` in a
`PRIVATE-TOKEN` header, private and with a README unless told otherwise (D1). GitLab creates a
project in a group by id, so when `group` is given the tool first looks the group up by its
URL-encoded full path and uses the id as `namespace_id`; a failed lookup stops there and creates
nothing. GitLab means gitlab.com only (D3).

It answers in the same shape as the GitHub tool (`name`, `full_name`, `html_url`, `clone_url`,
`visibility`, optional `default_branch`), so `toolResult` needed no change and a test checks the
two output schemas stay the same. It reuses the helpers from Task 2. GitLab reports errors as a
plain string, as an object of field errors, or as an OAuth-style pair, and the tool reads all
three; a taken name arrives as a 400 with `name has already been taken`. Name and group are
checked against GitLab's path rules before the token is read, including the rule that a project
path may not end in `.git` or `.atom`.

The registry, server and stdio tests now list five tools and allow both repository tools to change
things. `npm test`: 105 tests, 104 passing; the one failure is the baseline stdio test named in
Task 2, unchanged.

Left for task 4: the version, the changelog, the README, and the `PR` column.
