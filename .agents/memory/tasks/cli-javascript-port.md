---
name: memory-tasks-cli-javascript-port
description: Porting the cli MCP server from Python to JavaScript, laid out like shared-instruction, and keeping it stdio-only.
---

# Port cli to JavaScript

## 2026-10-09 — in progress

**Goal.** The host CLI MCP server runs on Node, like the other LXAgents servers, instead of
Python.

**Objective.** `node src/index.js` serves the same three tools — `run_command`, `read_file`,
`list_directory` — with the same schemas, limits, flags and refusal messages as the Python
server. No Python source remains. `npm test` is green.

**Detail.** Edit this repository only. The server stays stdio-only: it gives shell access, so it
is loaded locally by the client and never served over a network. There is no HTTP transport, no
express and no token code here. `shared-instruction` is the layout reference, not a dependency.

**Status:** in progress.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `chore/cli-javascript-plan` | |
| 2 | Port the server to JavaScript | `feat/javascript-server` | |
| 3 | Release | `release/{version}` | |

Branches stack: task 1 from `master`, task `k` from task `k-1`. The `PR` column is filled by
task 3.

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

Different: the timeout kill reaches the whole process tree on POSIX through a process group, not
only on Windows through `taskkill`; the protocol layer is the SDK's; tool descriptions no longer
name `cmd.exe` alone.

## Task entries

### Task 1 — chore/cli-javascript-plan

Landed: this record and its row in `memory-index.md`. The `PR` column is filled by task 3, not
here, so no later branch needs a rebase. Nothing outside `.agents/` changes in this task. Task 2
depends on nothing from this entry except the plan above.
