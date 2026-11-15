//! `lxagents-cli`: an MCP server that gives an LLM the host's command line and file system.
//!
//! Stdio is the only transport, on purpose. Free-form shell execution must never be reachable
//! over a network, so there is no HTTP transport here and no token to configure: the client
//! spawns this process and speaks to it over a pipe, which is as far as its reach goes.
//!
//! The modules import only downward: `routes` → `controllers` → `services` → `models` →
//! `utils` → `config`. Nothing in this crate writes to stdout: on stdio, stdout is the JSON-RPC
//! channel and belongs to the transport.
#![forbid(unsafe_code)]

pub mod config;
pub mod controllers;
pub mod models;
pub mod routes;
pub mod services;
pub mod utils;
