//! The server's identity, as `initialize` reports it.

/// The version, from `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The name a client sees in `serverInfo`. Unchanged since the Python version.
pub const SERVER_NAME: &str = "host-cli";
