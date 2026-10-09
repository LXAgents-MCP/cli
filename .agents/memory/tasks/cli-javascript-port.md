---
name: memory-tasks-cli-javascript-port
description: Porting the cli MCP server from Python to JavaScript, laid out like shared-instruction, and keeping it stdio-only.
---

# Port cli to JavaScript

## 2026-10-09 — done

**Goal.** The host CLI MCP server runs on Node, like the other LXAgents servers, instead of
Python.

**Objective.** `node src/index.js` serves the same three tools — `run_command`, `read_file`,
`list_directory` — with the same schemas, limits, flags and refusal messages as the Python
server. No Python source remains. `npm test` is green.

**Detail.** Edit this repository only. The server stays stdio-only: it gives shell access, so it
is loaded locally by the client and never served over a network. There is no HTTP transport, no
express and no token code here. `shared-instruction` is the layout reference, not a dependency.

**Status:** done. Pull requests #1, #2 and #3, merged in that order by rebase, each branch deleted as it merged.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `chore/cli-javascript-plan` | [#1](https://github.com/LXAgents-MCP/cli/pull/1) |
| 2 | Port the server to JavaScript | `feat/javascript-server` | [#2](https://github.com/LXAgents-MCP/cli/pull/2) |
| 3 | Release | `release/2.0.0` | [#3](https://github.com/LXAgents-MCP/cli/pull/3) |

Branches stack: task 1 from `master`, task `k` from task `k-1`. The `PR` column was filled by
task 3, once the pull requests existed.

## Decisions the owner approved with the plan

| # | Decision |
|---|---|
| D1 | Convention-named stacked branches, not the harness-named `claude/…` branch. |
| D2 | The official MCP SDK and zod, as in `shared-instruction`. `npm install` is now required, so the README's "no installation" line goes. |
| D3 | `cli` has no `AGENTS.md`, `.agents/` or `wiki/logs/`. Only what the record and the release need is created: `.agents/memory/` with its index, and `wiki/logs/` with its index. The rest of the instruction set is not adopted here. |
| D4 | Stdio only. The token work in `shared-instruction` and `security` does not apply to this repository. |

## Behaviour kept, and the deliberate differences

Kept: tool names, input and output schemas, annotations, `--confine` / `--allow` / `--timeout`,
the limits (30 s default and 600 s ceiling, 30 000 output characters, 500 listing entries,
200 000 file bytes), the result shape (text block, `structuredContent`, `isError`), and the
refusal messages.

Different, by design: the timeout kill reaches the whole process tree on POSIX through a process
group, not only on Windows through `taskkill`; the protocol layer is the SDK's; tool descriptions
no longer name `cmd.exe` alone. The full list of differences the port ended up with is in the
Task 2 entry below.

## Task entries

### Task 1 — chore/cli-javascript-plan

Landed: this record and its row in `memory-index.md`. The `PR` column is filled by task 3, not
here, so no later branch needs a rebase. Nothing outside `.agents/` changes in this task. Task 2
depends on nothing from this entry except the plan above.

### Task 2 — feat/javascript-server

Landed. `node src/index.js` serves `run_command`, `read_file` and `list_directory` over stdio, and
the Python source is gone. `npm test` runs 57 tests, all passing: the helpers, the registry, each
tool, the server over an in-memory client, and the real process over a stdio pipe.

Layout follows `shared-instruction`: `src/{index,server,options,config,version,log}.js`, one module
per tool under `src/tools/` with a discovering registry, `test/*.test.js`. Dependencies are the MCP
SDK and zod. Tools are still discovered from the directory, as in the Python version.

**Where the port differs from the Python server, all deliberate:**

- **No `structuredContent` on a refusal or a crash.** Python sent `{}`, but a client validates
  `structuredContent` against the tool's output schema whenever it is present, so a strict client
  would have rejected every refusal. A failing command still carries its full payload.
- **stdin is closed for a command, not inherited.** The server's stdin is the protocol channel; a
  child that inherited it could read the client's next message.
- **Process-tree kill on POSIX** through a process group (`detached` + `kill(-pid)`). A test starts
  a grandchild that holds the pipes and fails if the call waits on it; with the kill reduced to the
  shell alone that test fails, so it does bite. The check that the grandchild is gone counts a
  zombie as dead: a killed process stays visible to `kill(pid, 0)` until the host's init collects
  it, which took up to two seconds in the container the port was written in, and a fixed
  two-second poll failed once in six full runs because of it.
- **Argument type errors come from the SDK.** A missing or wrongly typed argument is rejected by the
  SDK's schema validation with its own wording, before the handler runs. The handler keeps its own
  messages for everything past that: empty `path`, missing directory, confinement, allowlist.
- **`read_file` on a missing file is a refusal**, not an internal error.
- **`list_directory` sets `truncated` only when entries were left out.** Python also set it for a
  directory of exactly 500.
- **`--timeout` must be a positive number.** Python ignored `0` and accepted a negative one, which
  made every command time out at once. The help text now says what the flag does: a default, not a
  ceiling; the ceiling stays 600 s.
- **The allowlist reads the first token without `shlex`**, handling a quoted token and both path
  separators; the name compared is still the file stem, lowercased.
- **`--help` and usage errors go to stderr**, so nothing in `src/` writes to stdout.

`package.json` is new and is private: this server gives shell access and is cloned, not published.
Its version is `1.2.0`, carried over from `config.py`, so this task makes no version claim; task 3
proposes the bump and waits for approval. The README is rewritten, with a short section for anyone
moving from the Python version. `npm install` is now required, which the old README advertised it
was not.

Left for task 3: version, changelog, the `wiki/logs/` index, the `PR` column and closing this record.

### Task 3 — release/2.0.0

Landed. The version is `2.0.0`, approved by the owner: the runtime changes from Python to Node, so
every client changes how it starts the server. `package.json` and the lockfile carry it,
`wiki/logs/2/0/0/CHANGELOG.md` records it with the **Clients must** steps, and
`.agents/index/logs-index.md` is created with its row. No git tag was created; a tag carries a
version too and needs its own approval.

The `PR` column was filled and this record closed in the commit that followed, once the pull
requests existed. Nothing is stacked on this branch, so that commit invalidated nothing.
