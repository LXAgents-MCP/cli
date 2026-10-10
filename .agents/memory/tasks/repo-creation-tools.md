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
the Task 2 entry, once identified.
