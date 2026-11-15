# 5.0.0

**Released:** 2026-11-15

**Breaking: the server is a native Rust binary, `lxagents-cli`, and no longer runs on Node.** It is
built on the official MCP Rust SDK, `rmcp`, and still speaks MCP over stdio only: there is no HTTP
transport and no network listener. The tools, their schemas, descriptions and annotations, the flags,
limits, results and refusal messages are the same as in 4.0.0; `tools/list` is identical.

**Clients must:** run `cargo build --release` once in the clone (Rust 1.89 or newer), set the client
configuration's `command` to the path of `target/release/lxagents-cli` (`.exe` on Windows), remove
`dist/index.js` from `args` while keeping any flags, and restart the client. Node is no longer needed.

## Added

- `Cargo.toml` and `Cargo.lock`: the crate `lxagents-cli`, edition 2024, `rust-version` 1.89, with a
  library and a binary of the same name.
- Dependencies `rmcp` 3.10.0 (`server`, `transport-io`), `tokio` 1.54.1, `serde_json` 1.0.154,
  `encoding_rs` 0.8.44, `dunce` 1.0.5, and on macOS and Linux `nix` 0.31.3.
- `tests/fixtures/tools-list.json`, which pins the advertised tool surface.

## Changed

- Every module in `src/` is Rust, in the same folders; `config/config` is now `config/settings.rs`.
- The usage text reads `Usage: lxagents-cli [options]`.
- A wrong argument type is refused with a sentence naming the argument, for example
  `` `path` must be a string, got number. ``, instead of the SDK's `Input validation error` text.
  An unknown tool reads `Tool <name> not found.` Both are still `isError` results.
- A handler crash reads `**Internal Error**` with the error kind, such as `PermissionDenied: …` or
  `Panic: …`, instead of a JavaScript error name.
- Output truncation counts characters rather than UTF-16 code units, and listings order names by
  lowercased code point rather than by locale collation. Both differ only for unusual names or text.
- Responses to concurrent requests may arrive in a different order; JSON-RPC matches them by id.

## Removed

- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.test.json`, and every `.ts` file in
  `src/` and `test/`. The `npm` scripts are replaced by `cargo build`, `cargo test`, `cargo clippy`
  and `cargo fmt`.

## Verified

`cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`: clean. `cargo test`: 66 passing,
none failing (the 57 TypeScript tests, ported, plus new ones), including the stdio suite against the
built binary. `lxagents-cli --help` prints the usage to stderr and exits 0.
