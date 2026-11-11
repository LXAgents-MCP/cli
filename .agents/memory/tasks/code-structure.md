---
name: memory-tasks-code-structure
description: Giving the cli server the same src layout as github and gitlab, one job per file, with no change a client can see; released as 3.0.1.
---

# Code structure — cli

## 2026-11-11 — in progress

**Goal.** The owner asked for every repository to be checked against `CODE_PERF.md`: one job per
file, no tangled dependencies, a directory layout that scales, and no redundant logic. `cli` has never
been restructured. `src/tools/common.js` holds six unrelated helpers, `src/options.js` (configuration)
imports from the tools folder, `run-command.js` carries process management beside its tool contract,
and `src/server.js` renders every result shape inline. Its layout also differs from `github` and
`gitlab`, so the same idea lives in a different place in each repository.

**Objective.** `src/` holds `index.js` and the sibling folders, each file with one job:

| Path | Holds |
|---|---|
| `src/index.js` | The entry: parse the options, apply them, serve stdio. |
| `src/routes/server.js` | The MCP server and tool dispatch (was `src/server.js`). |
| `src/controllers/` | The tool modules and the registry (was `src/tools/`); each holds `TOOL` and `handle` only. |
| `src/services/paths.js` | Real-path resolution and the `--confine` check. |
| `src/services/allowlist.js` | The executable name of a command line and the `--allow` check. |
| `src/services/process.js` | Spawning a command and killing its process tree. |
| `src/models/args.js` | Reading the `timeout` argument. |
| `src/utils/` | `errors.js` (`Refused`), `log.js`, `render.js` (result text per shape), `text.js` (decode, truncate). |
| `src/config/` | `config.js`, `options.js` (parsing only), `version.js`. |

Imports only flow downward: routes, controllers, services, models, utils, config. `npm test` passes
with the same 57 tests, and `node src/index.js` serves the same three tools.

**Detail.** A move and a split, not a rewrite: no tool, argument, description, flag, limit or message
changes. Files move with `git mv` and no shim is left at an old path. The owner is away and asked for
the recommended option wherever a question comes up; the choices are below. Baseline: 57 passing.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/code-structure` | |
| 2 | Split src by role | `refactor/code-structure` | |
| 3 | Corrected documentation | `docs/code-structure` | |
| 4 | Release | `release/3.0.1` | |

Branches stacked: task 1 from `master`, task `k` from task `k-1`. The same names are used in `github`,
`gitlab` and `template`; no chain depends on another.

## Decisions

| # | Decision |
|---|---|
| D1 | The layout is the one `github` and `gitlab` adopted in 0.5.0, so one map serves all three servers. |
| D2 | `applyOptions` moves into `src/index.js`, the one place that wires the parsed command line into `config`. `config/options.js` then imports nothing from above it. |
| D3 | The release is `3.0.1`, a patch: `node src/index.js` is the only path anyone runs and it does not move. No tag, nothing published. |
| D4 | Behaviour noticed and left alone, because changing it is not a refactor: the stdio entry handles `SIGINT` and not `SIGTERM`. |

## Task entries

### Task 1 — plan/code-structure

Landed: this record and its row in `memory-index.md`. Nothing outside `.agents/` changes. The `PR`
column is filled by the release task.
