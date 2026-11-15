//! The server over the protocol, on an in-memory pipe.
mod common;

use std::sync::Arc;

use common::*;
use lxagents_cli::config::settings::Config;
use lxagents_cli::config::version::{SERVER_NAME, VERSION};
use lxagents_cli::controllers::{Registry, list_directory, read_file};
use lxagents_cli::models::tool::{ToolArgs, ToolFuture, ToolSpec};
use lxagents_cli::routes::server::HostCli;
use serde_json::{Value, json};

#[tokio::test]
async fn the_server_identifies_itself() {
    let client = connect(Config::default()).await;
    let info = client.peer_info().expect("server info");

    let server = info.server_info.as_ref().expect("an implementation");
    assert_eq!(server.name, SERVER_NAME);
    assert_eq!(server.version, VERSION);

    let capabilities = serde_json::to_value(&info.capabilities).unwrap();
    assert_eq!(capabilities, json!({"tools": {"listChanged": true}}));
}

#[tokio::test]
async fn tools_list_advertises_the_three_tools_as_4x_did() {
    let client = connect(Config::default()).await;
    let tools = client.list_all_tools().await.unwrap();

    let actual: Vec<Value> = tools
        .iter()
        .map(|tool| serde_json::to_value(tool).unwrap())
        .collect();
    let expected: Value = serde_json::from_str(include_str!("fixtures/tools-list.json")).unwrap();
    assert_eq!(Value::Array(actual), expected);
}

#[tokio::test]
async fn list_directory_renders_entries_and_structured_content() {
    let client = connect(Config::default()).await;
    let (_guard, dir) = scratch();
    std::fs::create_dir(dir.join("sub")).unwrap();
    std::fs::write(dir.join("a.txt"), "abc").unwrap();

    let result = call(&client, "list_directory", json!({"path": dir})).await;

    assert!(!is_error(&result));
    assert_eq!(
        text(&result),
        format!(
            "**2 entries in {}.**\n\n- `sub`/\n- `a.txt`  (3 bytes)",
            dir.display()
        )
    );
    assert_eq!(fields(&result)["entries"][0]["name"], "sub");
    assert_eq!(fields(&result)["entries"][1]["name"], "a.txt");
}

#[tokio::test]
async fn read_file_renders_the_content_in_a_fenced_block() {
    let client = connect(Config::default()).await;
    let (_guard, dir) = scratch();
    std::fs::write(dir.join("a.txt"), "hello").unwrap();

    let result = call(&client, "read_file", json!({"path": dir.join("a.txt")})).await;

    assert!(!is_error(&result));
    assert!(text(&result).contains("```text\nhello\n```"));
    assert_eq!(fields(&result)["bytes_read"], 5);
}

#[cfg(unix)]
#[tokio::test]
async fn run_command_renders_both_streams() {
    let client = connect(Config::default()).await;
    let (_guard, dir) = scratch();

    let result = call(
        &client,
        "run_command",
        json!({"path": dir, "cmd": "echo out; echo err >&2"}),
    )
    .await;

    assert!(!is_error(&result));
    assert!(
        matches(
            &text(&result),
            "**Exited 0 in *ms.**\n\n```\nout\n\n```\n\n**stderr**\n\n```\nerr\n\n```\n"
        ),
        "{}",
        text(&result)
    );
    assert_eq!(fields(&result)["exit_code"], 0);
}

#[cfg(unix)]
#[tokio::test]
async fn a_failing_command_is_an_error_result_that_still_carries_its_output() {
    let client = connect(Config::default()).await;
    let (_guard, dir) = scratch();

    let result = call(
        &client,
        "run_command",
        json!({"path": dir, "cmd": "echo why; exit 2"}),
    )
    .await;

    assert!(is_error(&result));
    assert_eq!(fields(&result)["exit_code"], 2);
    assert_eq!(fields(&result)["stdout"], "why\n");
    assert!(text(&result).starts_with("**Exited 2 in "));
}

#[tokio::test]
async fn a_refusal_is_an_error_result_with_the_reason_and_no_structured_content() {
    let client = connect(Config::default()).await;
    let (_guard, dir) = scratch();

    let result = call(&client, "list_directory", json!({"path": dir.join("nope")})).await;

    assert!(is_error(&result));
    assert_eq!(result.structured_content, None);
    assert_eq!(
        text(&result),
        format!(
            "**Refused**\n\n`path` {} does not exist.",
            dir.join("nope").display()
        )
    );
}

#[tokio::test]
async fn confinement_refuses_a_path_outside_the_root() {
    let (_guard, parent) = scratch();
    let root = parent.join("root");
    std::fs::create_dir(&root).unwrap();
    let client = connect(Config {
        confine_root: Some(root.clone()),
        ..Config::default()
    })
    .await;

    let inside = call(&client, "list_directory", json!({"path": root})).await;
    let outside = call(&client, "list_directory", json!({"path": parent})).await;

    assert!(!is_error(&inside));
    assert!(is_error(&outside));
    assert!(text(&outside).contains("outside the allowed root"));
}

#[tokio::test]
async fn a_call_with_no_path_or_to_no_such_tool_is_an_error_result_and_not_a_crash() {
    let client = connect(Config::default()).await;

    let no_path = call(&client, "read_file", json!({})).await;
    assert!(is_error(&no_path));
    assert!(text(&no_path).contains("`path` is required"));

    let wrong_type = call(&client, "read_file", json!({"path": 5})).await;
    assert!(is_error(&wrong_type));
    assert_eq!(
        text(&wrong_type),
        "**Refused**\n\n`path` must be a string, got number."
    );

    let unknown = call(&client, "no_such_tool", json!({})).await;
    assert!(is_error(&unknown));
    assert_eq!(
        text(&unknown),
        "**Refused**\n\nTool no_such_tool not found."
    );

    // The server is still serving.
    assert_eq!(client.list_all_tools().await.unwrap().len(), 3);
}

fn panics(_: Arc<Config>, _: ToolArgs) -> ToolFuture {
    Box::pin(async { panic!("boom") })
}

#[tokio::test]
async fn a_handler_that_panics_is_an_internal_error_and_the_server_carries_on() {
    let crashing = ToolSpec {
        name: list_directory::NAME,
        definition: list_directory::definition,
        handle: panics,
    };
    let registry = Registry::new(vec![crashing, read_file::spec()]).unwrap();
    let client = connect_to(HostCli::with_registry(Config::default(), registry)).await;
    let (_guard, dir) = scratch();
    std::fs::write(dir.join("a.txt"), "x").unwrap();

    let result = call(&client, "list_directory", json!({"path": dir})).await;

    assert!(is_error(&result));
    assert_eq!(result.structured_content, None);
    assert_eq!(text(&result), "**Internal Error**\n\nPanic: boom");

    let after = call(&client, "read_file", json!({"path": dir.join("a.txt")})).await;
    assert!(!is_error(&after));
}
