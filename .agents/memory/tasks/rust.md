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

### Task 2 — refactor/rust

Landed. The Node toolchain is gone: `package.json`, `package-lock.json`, `tsconfig.json`,
`tsconfig.test.json`, every `.ts` file in `src/` and `test/`. In its place a Cargo crate
`lxagents-cli` (still `4.0.0`; the release task bumps it), edition 2024, `rust-version` 1.89 (the
highest among the resolved dependencies, `uuid` through rmcp), with `Cargo.lock` committed.
Dependencies: `rmcp` 3.10.0 (`server`, `transport-io`), `tokio` 1.54.1, `serde_json` 1.0.154
(`preserve_order`, so schema properties keep their order), `encoding_rs` 0.8.44, `dunce` 1.0.5, and on
POSIX `nix` 0.31.3 (`signal`) for the process-group kill. Dev: `rmcp` with `client` and
`transport-child-process`, `tempfile` 3.27.0. No `axum` (D1). `#![forbid(unsafe_code)]` holds in the
library and the binary.

Layout, one job per file, imports flowing downward: `main.rs`, `lib.rs`, `routes/server.rs`
(`HostCli`, a hand-written `ServerHandler`), `controllers/{mod,list_directory,read_file,run_command}.rs`,
`services/{paths,allowlist,process}.rs`, `models/{args,tool}.rs`, `utils/{errors,log,render,text}.rs`,
`config/{settings,options,version}.rs`. `config/config.ts` became `config/settings.rs`: clippy refuses a
module named like its parent, and `settings` is the name the template uses.

Two fixes found by the ported tests: the kill takes the process id at spawn, because `Child::id` is
gone once the shell is reaped while a background job still holds the pipe; and a client that closes
stdin before the handshake ends the process with 0, as in 4.x. Responses may now arrive out of order,
since rmcp serves requests concurrently; JSON-RPC matches them by id.

Checked: `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean. `cargo test`
runs 66 tests, all passing: 48 unit tests in the modules, 10 protocol tests over an in-memory pipe and
8 against the built binary over stdio. `tools/list` from the binary is identical to the 4.0.0 server's,
compared as JSON (the fixture is `tests/fixtures/tools-list.json`, without the SDK-added `execution`
field, which rmcp does not have).

Left for task 3: `README.md` still describes Node, `npm install` and `dist/index.js`.

### Task 3 — docs/rust

Landed. `README.md` asks for Rust 1.89+ instead of Node, builds with `cargo build --release` (or
`cargo install --path .`), points both client examples' `command` at the binary with no `args` entry
for the script, lists the `cargo` build, test, clippy and fmt commands and the Inspector line, names
the `.rs` files in the folder table (with `config/settings.rs`), says how a tool is added, and gains a
"Moving from 4.x" section; "Moving from 3.x" and "Moving from the Python version" now point at it.
Released changelogs and earlier task records keep `dist/index.js` and `src/index.js`: they describe
the tree as it was.
