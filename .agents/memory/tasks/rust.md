---
name: memory-tasks-rust
description: Rewriting the cli server from TypeScript to Rust on the official MCP Rust SDK (rmcp), kept stdio-only, with the same tools, schemas, flags, limits and messages.
---

# Rust rewrite — cli

## 2026-11-14 — in progress

**Goal.** The owner asked for every repository to move from TypeScript to Rust, on the official MCP
Rust SDK (`rmcp`, `modelcontextprotocol/rust-sdk`) with axum as the web framework. `cli` is the
host command-line server: three tools, stdio only, no network listener by design.

**Objective.**

* A Cargo crate `lxagents-cli` (edition 2024, `rust-version` 1.89) with a library and a binary of the
  same name. `rmcp` 3.10 (`server`, `transport-io`) is the protocol layer over stdio.
* `src/` keeps its folders as Rust modules — `routes`, `controllers`, `services`, `models`, `utils`,
  `config` — one job per file, imports flowing downward only.
* `run_command`, `read_file` and `list_directory` advertise the same input and output schemas,
  descriptions and annotations as 4.0.0, and return the same text, `structuredContent` and `isError`.
* `--confine`, `--allow`, `--timeout` and `-h/--help` behave as before; a bad command line exits 2 with
  nothing on stdout.
* The 57 TypeScript tests are ported; `cargo test`, `cargo clippy --all-targets -- -D warnings` and
  `cargo fmt --check` pass. The Node toolchain (`package.json`, lockfile, `tsconfig*.json`, `.ts`
  sources) is gone.

**Status:** in progress.

**Detail.** A change of language, not of behaviour, except where Rust has no equivalent (D7, D8, D11,
D12). The owner is away and asked for the recommended option wherever a question comes up; the
choices are below. Baseline before the work: 57 passing on `npm test`. The shared instruction
connector was not loaded in the session, so its tools could not be read; the conventions followed
are this repository's own history and records. The full plan is
`reports/rust-cli-plan.md` in the project's shared files.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/rust` | |
| 2 | Rewrite in Rust | `refactor/rust` | |
| 3 | Corrected documentation | `docs/rust` | |
| 4 | Release | `release/5.0.0` | |

Branches stacked: task 1 from `master`, task `k` from task `k-1`. No chain in another repository
depends on this one.

## Decisions

| # | Decision |
|---|---|
| D1 | **No axum, stdio only.** The server runs arbitrary shell commands and has been stdio-only on purpose since 2.0.0; an HTTP listener would make it a remote shell. axum stays the framework for the repositories that serve HTTP. |
| D2 | The binary is `lxagents-cli`; the MCP server name stays `host-cli`; the version comes from `CARGO_PKG_VERSION`. |
| D3 | The tool registry is a static list in `controllers/mod.rs`. A test fails if a file in `src/controllers/` is not registered, and building the registry fails on a duplicate name. Rust cannot import modules at run time. |
| D4 | Schemas are literal JSON copied from the 4.0.0 `tools/list`, so a client sees identical schemas. |
| D5 | Flags are parsed by hand with Node `parseArgs` semantics. `clap` would print `--help` to stdout, the protocol channel. |
| D6 | `Config` is built once in `main` and shared immutably (`Arc<Config>`), instead of a mutable module object. |
| D7 | Each handler checks argument types itself; a wrong type is a refusal naming the argument. The TS SDK's `Input validation error` wording is not reproduced. |
| D8 | An unknown tool is an `isError` result, `Tool <name> not found.` |
| D9 | An unexpected I/O error or a panic in a handler is `**Internal Error**`, logged to stderr; the server keeps serving. |
| D10 | Commands run through `/bin/sh -c` or `cmd.exe /d /s /c`, stdin closed, in their own process group, killed as a tree on timeout, with a 5 s drain backstop — as in 4.0.0. |
| D11 | Output truncation counts characters (Unicode scalar values), not UTF-16 code units. |
| D12 | Listings order directories first, then by lowercased name in code-point order (no ICU collation). |
| D13 | The release is `5.0.0`, a major: the client starts a native binary instead of `node dist/index.js`. No tag, nothing published. |
| D14 | No CI workflow is added; none exists and none was asked for. |

## Task entries

### Task 1 — plan/rust

Landed: this record and its row in `memory-index.md`. Nothing outside `.agents/` changes. The `PR`
column is filled by the release task.
