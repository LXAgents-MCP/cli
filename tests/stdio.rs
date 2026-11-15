//! The server as a client actually runs it: the built binary, spoken to over a real pipe. The
//! things that go wrong here - a stray write to stdout, a flag that never reaches the handlers, a
//! process that outlives its client - do not reproduce on an in-memory pipe.
mod common;

use std::process::{Command as StdCommand, Stdio};
use std::time::Duration;

use common::*;
use rmcp::ServiceExt;
use rmcp::transport::TokioChildProcess;
use serde_json::json;
use tokio::process::Command;

const ENTRY: &str = env!("CARGO_BIN_EXE_lxagents-cli");

/// A client attached to `lxagents-cli <args>` over stdio.
async fn spawn(args: &[&str]) -> Client {
    let mut command = Command::new(ENTRY);
    command.args(args);
    let transport = TokioChildProcess::builder(command)
        .stderr(Stdio::null())
        .spawn()
        .expect("the server starts")
        .0;
    ().serve(transport).await.expect("the client connects")
}

#[tokio::test]
async fn over_stdio_the_server_lists_its_tools_and_answers_a_call() {
    let client = spawn(&[]).await;
    let (_guard, dir) = scratch();
    std::fs::write(dir.join("a.txt"), "x").unwrap();

    let mut names: Vec<String> = client
        .list_all_tools()
        .await
        .unwrap()
        .into_iter()
        .map(|tool| tool.name.into_owned())
        .collect();
    names.sort();
    let result = call(&client, "list_directory", json!({"path": dir})).await;

    assert_eq!(names, ["list_directory", "read_file", "run_command"]);
    assert!(!is_error(&result));
    assert_eq!(
        fields(&result)["entries"],
        json!([{"name": "a.txt", "type": "file", "size": 1}])
    );
}

#[tokio::test]
async fn confine_reaches_the_handlers() {
    let (_guard, parent) = scratch();
    let root = parent.join("root");
    std::fs::create_dir(&root).unwrap();
    let client = spawn(&["--confine", &root.to_string_lossy()]).await;

    let inside = call(&client, "list_directory", json!({"path": root})).await;
    let outside = call(&client, "list_directory", json!({"path": parent})).await;

    assert!(!is_error(&inside));
    assert!(is_error(&outside));
    assert!(text(&outside).contains("outside the allowed root"));
}

#[tokio::test]
async fn allow_reaches_the_handlers() {
    let (_guard, dir) = scratch();
    let client = spawn(&["--allow", "git, NPM"]).await;

    let refused = call(
        &client,
        "run_command",
        json!({"path": dir, "cmd": format!("\"{ENTRY}\" --help")}),
    )
    .await;

    assert!(is_error(&refused));
    assert!(
        text(&refused).contains("not in the allowlist. Allowed: git, npm."),
        "{}",
        text(&refused)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_becomes_the_default_for_a_call_that_names_none() {
    let (_guard, dir) = scratch();
    let client = spawn(&["--timeout", "1"]).await;

    let result = call(
        &client,
        "run_command",
        json!({"path": dir, "cmd": "sleep 20"}),
    )
    .await;

    assert!(is_error(&result));
    assert_eq!(fields(&result)["timed_out"], true);
}

#[test]
fn a_bad_command_line_exits_2_with_the_reason_on_stderr_and_nothing_on_stdout() {
    let cases: [&[&str]; 6] = [
        &["--bogus"],
        &["--timeout", "abc"],
        &["--timeout", "0"],
        &["--timeout", "-3"],
        &["--confine"],
        &["stray"],
    ];
    for args in cases {
        let run = StdCommand::new(ENTRY)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();

        assert_eq!(run.status.code(), Some(2), "{args:?}");
        assert!(run.stdout.is_empty(), "{args:?} wrote to stdout");
        assert!(
            String::from_utf8_lossy(&run.stderr).contains("Usage: lxagents-cli"),
            "{args:?}"
        );
    }
}

#[test]
fn help_prints_the_usage_to_stderr_leaves_stdout_empty_and_exits_0() {
    for flag in ["--help", "-h"] {
        let run = StdCommand::new(ENTRY)
            .arg(flag)
            .stdin(Stdio::null())
            .output()
            .unwrap();

        assert_eq!(run.status.code(), Some(0));
        assert!(run.stdout.is_empty());
        assert!(String::from_utf8_lossy(&run.stderr).contains("--confine DIR"));
    }
}

#[tokio::test]
async fn the_process_exits_by_itself_when_its_client_goes_away() {
    let mut child = Command::new(ENTRY)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    drop(child.stdin.take());

    let status = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    let status = match status {
        Ok(status) => status.unwrap(),
        Err(_) => {
            let _ = child.kill().await;
            panic!("still running 5 s after stdin closed");
        }
    };
    assert_eq!(status.code(), Some(0));
}

#[tokio::test]
async fn startup_logs_to_stderr_and_stdout_carries_only_json_rpc() {
    let mut child = Command::new(ENTRY)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    drop(child.stdin.take());
    let output = tokio::time::timeout(Duration::from_secs(5), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();

    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("host-cli "));
}
