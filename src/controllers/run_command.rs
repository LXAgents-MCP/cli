//! `run_command`: run a command on the host machine.
use std::sync::Arc;
use std::time::Instant;

use rmcp::model::{Tool, ToolAnnotations};
use serde_json::{Value, json};

use crate::config::settings::{Config, MAX_TIMEOUT};
use crate::models::args::{clamp_timeout, optional_number, type_name};
use crate::models::tool::{ToolArgs, ToolFuture, ToolOutcome, ToolSpec, object};
use crate::services::allowlist::check_allowlist;
use crate::services::paths::{Expect, resolve_path};
use crate::services::process::run;
use crate::utils::errors::ToolError;
use crate::utils::text::{decode, truncate};

pub const NAME: &str = "run_command";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME,
        definition,
        handle,
    }
}

pub fn definition() -> Tool {
    Tool::new(
        NAME,
        "Run a command on the host machine and return its exit code, stdout, stderr, and \
         duration. Use this when work has to happen on the host - running scripts, \
         invoking a build or test runner, or inspecting host state the sandbox \
         cannot see. Any directory on the machine may be used. A command that outruns \
         `timeout` has its whole process tree killed, and the server carries on serving.",
        object(json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Working directory. Required - there is no default. Absolute, or relative to the server's own working directory. A path that does not exist is refused."
                },
                "cmd": {
                    "type": "string",
                    "description": "The command line, run through the host shell (cmd.exe on Windows, /bin/sh elsewhere). Quote paths containing spaces. Example: 'node main.js --dry-run'."
                },
                "timeout": {
                    "description": format!(
                        "Seconds to wait. Defaults to the server's setting (30 unless it was started with --timeout), ceiling {MAX_TIMEOUT}. A command that exceeds it is killed and reported as a timeout - the server stays up and keeps serving."
                    ),
                    "type": "number"
                }
            },
            "required": ["path", "cmd"]
        })),
    )
    .with_raw_output_schema(object(json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "exit_code": {"type": "integer", "minimum": -9007199254740991i64, "maximum": 9007199254740991i64},
            "stdout": {"type": "string"},
            "stderr": {"type": "string"},
            "duration_ms": {"type": "integer", "minimum": -9007199254740991i64, "maximum": 9007199254740991i64},
            "truncated": {"type": "boolean"},
            "timed_out": {"type": "boolean"},
            "cwd": {"type": "string"}
        },
        "required": ["exit_code", "stdout", "stderr", "timed_out", "cwd"],
        "additionalProperties": false
    })))
    .with_annotations(
        ToolAnnotations::new()
            .read_only(false)
            .destructive(true)
            .idempotent(false)
            .open_world(true),
    )
}

pub fn handle(config: Arc<Config>, args: ToolArgs) -> ToolFuture {
    Box::pin(async move {
        let cwd = resolve_path(args.get("path"), &config, Expect::Dir)?;

        let command = match args.get("cmd") {
            Some(Value::String(text)) if !text.trim().is_empty() => text.clone(),
            Some(
                other @ (Value::Bool(_) | Value::Number(_) | Value::Array(_) | Value::Object(_)),
            ) => {
                return Err(ToolError::refused(format!(
                    "`cmd` must be a string, got {}.",
                    type_name(other)
                )));
            }
            _ => {
                return Err(ToolError::refused(
                    "`cmd` is required and must be a non-empty string, for example 'node main.js --dry-run'.",
                ));
            }
        };

        check_allowlist(&command, &config)?;
        let timeout = clamp_timeout(optional_number(&args, "timeout")?, config.default_timeout);

        let started = Instant::now();
        let result = run(&command, &cwd, timeout).await;
        let duration_ms = started.elapsed().as_millis() as u64;

        let (stdout, cut_out) = truncate(decode(&result.stdout));
        let (stderr, cut_err) = truncate(decode(&result.stderr));

        let summary = if result.timed_out {
            format!(
                "Timed out after {timeout:.0}s and was killed (exit {}). The server is unaffected.",
                result.exit_code
            )
        } else {
            format!("Exited {} in {duration_ms}ms.", result.exit_code)
        };

        let fields = json!({
            "exit_code": result.exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "duration_ms": duration_ms,
            "truncated": cut_out || cut_err,
            "timed_out": result.timed_out,
            "cwd": cwd.to_string_lossy(),
        });

        Ok(ToolOutcome {
            summary,
            fields: fields.as_object().cloned().unwrap_or_default(),
            ok: result.exit_code == 0 && !result.timed_out,
        })
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::config::settings::MAX_OUTPUT;
    use std::path::PathBuf;

    fn scratch() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        (dir, real)
    }

    async fn call(config: Config, args: Value) -> Result<ToolOutcome, ToolError> {
        handle(Arc::new(config), args.as_object().cloned().unwrap()).await
    }

    #[tokio::test]
    async fn runs_a_command_in_the_given_directory() {
        let (_guard, dir) = scratch();

        let outcome = call(
            Config::default(),
            json!({"path": dir.to_string_lossy(), "cmd": "pwd"}),
        )
        .await
        .unwrap();

        assert!(outcome.ok);
        assert_eq!(outcome.fields["exit_code"], 0);
        assert_eq!(outcome.fields["stdout"], format!("{}\n", dir.display()));
        assert_eq!(outcome.fields["cwd"], json!(dir.to_string_lossy()));
        assert_eq!(outcome.fields["timed_out"], false);
        assert_eq!(outcome.fields["truncated"], false);
        assert!(outcome.summary.starts_with("Exited 0 in "));
    }

    #[tokio::test]
    async fn a_failing_command_is_not_ok_and_keeps_its_output() {
        let (_guard, dir) = scratch();

        let outcome = call(
            Config::default(),
            json!({"path": dir.to_string_lossy(), "cmd": "echo why; echo no >&2; exit 2"}),
        )
        .await
        .unwrap();

        assert!(!outcome.ok);
        assert_eq!(outcome.fields["exit_code"], 2);
        assert_eq!(outcome.fields["stdout"], "why\n");
        assert_eq!(outcome.fields["stderr"], "no\n");
        assert!(outcome.summary.starts_with("Exited 2 in "));
    }

    #[tokio::test]
    async fn a_timeout_is_reported_and_the_default_comes_from_config() {
        let (_guard, dir) = scratch();
        let config = Config {
            default_timeout: 1.0,
            ..Config::default()
        };

        let outcome = call(
            config,
            json!({"path": dir.to_string_lossy(), "cmd": "sleep 20"}),
        )
        .await
        .unwrap();

        assert!(!outcome.ok);
        assert_eq!(outcome.fields["timed_out"], true);
        assert_eq!(outcome.fields["exit_code"], -1);
        assert_eq!(
            outcome.summary,
            "Timed out after 1s and was killed (exit -1). The server is unaffected."
        );
    }

    #[tokio::test]
    async fn long_output_is_truncated() {
        let (_guard, dir) = scratch();
        let cmd = format!("head -c {} /dev/zero | tr '\\0' a", MAX_OUTPUT + 10);

        let outcome = call(
            Config::default(),
            json!({"path": dir.to_string_lossy(), "cmd": cmd}),
        )
        .await
        .unwrap();

        assert_eq!(outcome.fields["truncated"], true);
        assert!(
            outcome.fields["stdout"]
                .as_str()
                .unwrap()
                .ends_with("\n... (truncated)")
        );
    }

    #[tokio::test]
    async fn refuses_an_empty_command_a_bad_timeout_and_an_unlisted_executable() {
        let (_guard, dir) = scratch();
        let path = dir.to_string_lossy().into_owned();

        let empty = call(Config::default(), json!({"path": path, "cmd": "  "}))
            .await
            .unwrap_err();
        assert!(empty.to_string().starts_with("`cmd` is required"));

        let missing = call(Config::default(), json!({"path": path}))
            .await
            .unwrap_err();
        assert!(missing.to_string().starts_with("`cmd` is required"));

        let typed = call(Config::default(), json!({"path": path, "cmd": 5}))
            .await
            .unwrap_err();
        assert_eq!(
            typed,
            ToolError::refused("`cmd` must be a string, got number.")
        );

        let timeout = call(
            Config::default(),
            json!({"path": path, "cmd": "true", "timeout": "x"}),
        )
        .await
        .unwrap_err();
        assert_eq!(
            timeout,
            ToolError::refused("`timeout` must be a number, got string.")
        );

        let narrowed = Config {
            allowed_executables: vec!["git".to_string()],
            ..Config::default()
        };
        let refused = call(narrowed, json!({"path": path, "cmd": "rm -rf x"}))
            .await
            .unwrap_err();
        assert!(
            refused
                .to_string()
                .contains("not in the allowlist. Allowed: git.")
        );
    }

    #[tokio::test]
    async fn refuses_a_missing_working_directory() {
        let (_guard, dir) = scratch();
        let error = call(
            Config::default(),
            json!({"path": dir.join("nope").to_string_lossy(), "cmd": "true"}),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().ends_with("does not exist."));
    }
}
