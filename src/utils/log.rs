//! Diagnostics go to stderr, always.
//!
//! stdout is the protocol channel. One stray write corrupts the stream and the client reports a
//! JSON parse error that points at the payload rather than at the logging, which is the single
//! most common way a stdio MCP server fails. Nothing in this crate writes to stdout; the rmcp
//! transport is the only thing that does.
use std::io::Write;

/// Write one line to stderr. A failed write is ignored: there is nowhere else to report it.
pub fn log(message: &str) {
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, "{message}");
}
