---
name: memory-tasks-forge-servers
description: Removing create_github_repo and create_gitlab_repo from the cli MCP server now that lxagents-github and lxagents-gitlab serve them; released as 3.0.0.
---

# Forge servers — cli

## 2026-10-10 — in progress

**Goal.** The host-shell server no longer carries any forge code. GitHub and GitLab each have a
dedicated MCP server, `lxagents-github` and `lxagents-gitlab`, and `cli` goes back to what its name
says: the host's command line and file system.

**Objective.** `node src/index.js` serves three tools, `run_command`, `read_file` and
`list_directory`, and makes no network request. `create_github_repo` and `create_gitlab_repo` are
gone, with every helper only they used, their tests, and their sections of the README. `repo_create`
on the two new servers is their replacement and takes the same arguments. `npm test` is green and
no test reaches a host beyond this machine.

**Detail.** One request spans three repositories — `LXAgents-MCP/github`, `LXAgents-MCP/gitlab` and
this one — each with its own record under this slug. This repository is built last, so `repo_create`
exists elsewhere before it disappears here. Removing two tools breaks a client that calls them, so
the release is a major one, `3.0.0`, and its log says what a client must do. The shared instruction
set is not adopted here: this repository has no `AGENTS.md`, and adding one is outside this request.
The code being removed is `cli` commits `827b25a`, `c7d5bae`, `9babff7` and `5f9b64f`.

**Status:** in progress.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `chore/forge-servers-plan` | |
| 2 | Remove the forge tools | `refactor/forge-tools` | |
| 3 | Release | `release/3.0.0` | |

Branches stack: task 1 from `master`, task `k` from task `k-1`. The `PR` column is filled by a
closing commit once the pull requests exist.

## Decisions the owner approved with the plan

| # | Decision |
|---|---|
| D1 | Branches are named by convention (`chore/…`, `refactor/…`, `release/…`), never under `claude/`. |
| D2 | The release is `3.0.0`: two tools are removed, which breaks a client that calls them. No git tag is created and nothing is published without its own approval. |
| D3 | `cli` drops its two forge tools last. The `github` pull requests merge first, then `gitlab`, then these. |
| D4 | One pull request per branch, merged in order by rebase, each branch deleted as it merges. Pull request titles lead with `Breaking Change:` where the change is breaking. |
| D5 | The surface after is `run_command`, `read_file` and `list_directory`, with their flags, limits and refusal messages unchanged. What only the forge tools used goes with them: the token, redaction, text and flag helpers, `callApi`, the API timeout, and the `html_url` branch of the result renderer. |
| D6 | Released history is not edited: the 2.1.0 changelog and `repo-creation-tools.md` stay as written, and the 3.0.0 log says what changed. |
| D7 | Standing instruction: where a choice is needed, use the recommended option and add it to this table. |

## Task entries

### Task 1 — chore/forge-servers-plan

Landed: this record and its row in `memory-index.md`. Nothing outside `.agents/` changes in this
task. The `PR` column is filled by a closing commit, not here, so no later branch needs a rebase.

Baseline before any change: `npm test` ran 105 passing and none failing.

### Task 2 — refactor/forge-tools

Landed. `create_github_repo` and `create_gitlab_repo` are removed, with everything only they used. The
surface is `run_command`, `read_file` and `list_directory`, and `src/` makes no network request: no
`fetch` and no `https` remain in it.

What went, by file. The two tool modules; `test/github.test.js`, `test/gitlab.test.js` and
`test/api.test.js`, which tested them and the shared client; from `src/tools/common.js`, `requireToken`,
`redact`, `optionalText`, `optionalFlag` and `callApi`, none of which a host tool uses; `API_TIMEOUT_MS`
from `src/config.js`; the `html_url` branch of `toolResult` in `src/server.js`; and the repository
assertions in the registry, server and stdio tests, which are back to naming three tools. The README
loses its repository-tools section, the two environment variables and the sentence about outbound
requests, and gains a paragraph saying where the tools went (D5).

The source and test files other than the README are the ones the repository had before the forge
commits `827b25a`, `c7d5bae`, `9babff7` and `5f9b64f`, restored from the commit before them; nothing
else touched those files in between, which the diff against that commit shows is empty for `src/` and
`test/`. History is not rewritten, and the 2.1.0 changelog and `repo-creation-tools.md` stay as they
were (D6).

`npm test`: 57 tests, all passing, the number the suite had before the forge tools were added.

Left for task 3: the version, the changelog with what a client must do, and its row in the logs index.
