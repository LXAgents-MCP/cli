//! Helpers the integration suites share.
#![allow(dead_code)]

use std::path::PathBuf;

use rmcp::model::{CallToolRequestParams, CallToolResult};
use rmcp::service::RunningService;
use rmcp::{RoleClient, ServiceExt};
use serde_json::{Map, Value};

use lxagents_cli::config::settings::Config;
use lxagents_cli::routes::server::HostCli;

pub type Client = RunningService<RoleClient, ()>;

/// A scratch directory, by its real path, removed when the guard drops.
pub fn scratch() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let real = dunce::canonicalize(dir.path()).unwrap();
    (dir, real)
}

/// A client connected to `server` over an in-memory pipe.
pub async fn connect_to(server: HostCli) -> Client {
    let (server_end, client_end) = tokio::io::duplex(1 << 16);
    tokio::spawn(async move {
        if let Ok(running) = server.serve(server_end).await {
            let _ = running.waiting().await;
        }
    });
    ().serve(client_end).await.expect("the client connects")
}

/// A client connected to a fresh server with `config`.
pub async fn connect(config: Config) -> Client {
    connect_to(HostCli::new(config)).await
}

/// Call `name` with `args`, which must be a JSON object.
pub async fn call(client: &Client, name: &'static str, args: Value) -> CallToolResult {
    let args: Map<String, Value> = args.as_object().cloned().expect("arguments are an object");
    client
        .call_tool(CallToolRequestParams::new(name).with_arguments(args))
        .await
        .expect("tools/call answers")
}

/// The single text block of a result, which is what the model reads.
pub fn text(result: &CallToolResult) -> String {
    assert_eq!(
        result.content.len(),
        1,
        "expected exactly one content block"
    );
    result.content[0]
        .as_text()
        .expect("a text block")
        .text
        .clone()
}

/// The structured content of a result.
pub fn fields(result: &CallToolResult) -> &Value {
    result
        .structured_content
        .as_ref()
        .expect("structured content")
}

pub fn is_error(result: &CallToolResult) -> bool {
    result.is_error == Some(true)
}

/// Whether `text` matches `pattern`, a tiny glob where `*` is any run of characters.
pub fn matches(text: &str, pattern: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut rest = text;
    for (index, part) in parts.iter().enumerate() {
        if index == 0 {
            let Some(after) = rest.strip_prefix(part) else {
                return false;
            };
            rest = after;
        } else if index == parts.len() - 1 {
            return rest.ends_with(part);
        } else {
            let Some(at) = rest.find(part) else {
                return false;
            };
            rest = &rest[at + part.len()..];
        }
    }
    rest.is_empty()
}
