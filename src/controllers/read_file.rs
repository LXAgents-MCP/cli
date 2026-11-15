//! `read_file`: read a text file from the host.
use std::sync::Arc;

use rmcp::model::{Tool, ToolAnnotations};
use serde_json::json;
use tokio::io::AsyncReadExt;

use crate::config::settings::{Config, MAX_FILE_BYTES};
use crate::models::args::optional_integer;
use crate::models::tool::{ToolArgs, ToolFuture, ToolOutcome, ToolSpec, object};
use crate::services::paths::{Expect, resolve_path};
use crate::utils::errors::ToolError;
use crate::utils::text::decode;

pub const NAME: &str = "read_file";

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
        "Read a text file from the host and return its contents. Use this instead of shelling \
         out to `type` or `cat`: it handles Windows encodings and a byte cap, and it will \
         not mangle a file the way a console pipe does. Read-only.",
        object(json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File to read. Required - there is no default. Absolute, or relative to the server's own working directory. Must be an existing file."
                },
                "max_bytes": {
                    "description": format!("Maximum bytes to read. Default and ceiling {MAX_FILE_BYTES}."),
                    "type": "integer",
                    "minimum": -9007199254740991i64,
                    "maximum": 9007199254740991i64
                }
            },
            "required": ["path"]
        })),
    )
    .with_raw_output_schema(object(json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"},
            "bytes_read": {"type": "integer", "minimum": -9007199254740991i64, "maximum": 9007199254740991i64},
            "truncated": {"type": "boolean"}
        },
        "required": ["path", "content", "bytes_read", "truncated"],
        "additionalProperties": false
    })))
    .with_annotations(
        ToolAnnotations::new()
            .read_only(true)
            .destructive(false)
            .idempotent(true)
            .open_world(false),
    )
}

pub fn handle(config: Arc<Config>, args: ToolArgs) -> ToolFuture {
    Box::pin(async move {
        let target = resolve_path(args.get("path"), &config, Expect::Any)?;

        match tokio::fs::metadata(&target).await {
            Err(_) => {
                return Err(ToolError::refused(format!(
                    "`path` {} does not exist.",
                    target.display()
                )));
            }
            Ok(meta) if meta.is_dir() => {
                return Err(ToolError::refused(format!(
                    "`path` {} is a directory, not a file. Use list_directory on it instead.",
                    target.display()
                )));
            }
            Ok(_) => {}
        }

        let limit = match optional_integer(&args, "max_bytes")? {
            None => MAX_FILE_BYTES,
            Some(requested) => requested.clamp(1, MAX_FILE_BYTES as i64) as u64,
        };

        // One byte past the limit is how a file of exactly `limit` bytes is told from a longer one.
        let mut raw = Vec::new();
        tokio::fs::File::open(&target)
            .await?
            .take(limit + 1)
            .read_to_end(&mut raw)
            .await?;

        let truncated = raw.len() as u64 > limit;
        raw.truncate(limit as usize);

        let mut text = decode(&raw);
        // A UTF-8 BOM is an encoding artefact, not content.
        if text.starts_with('\u{FEFF}') {
            text.remove(0);
        }

        let summary = format!(
            "Read {} bytes from {}{}",
            raw.len(),
            target.display(),
            if truncated { " (truncated)." } else { "." }
        );
        let fields = json!({
            "path": target.to_string_lossy(),
            "content": text,
            "bytes_read": raw.len(),
            "truncated": truncated,
        });

        Ok(ToolOutcome {
            summary,
            fields: fields.as_object().cloned().unwrap_or_default(),
            ok: true,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::PathBuf;

    fn scratch() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        (dir, real)
    }

    async fn read(args: Value) -> Result<ToolOutcome, ToolError> {
        handle(
            Arc::new(Config::default()),
            args.as_object().cloned().unwrap(),
        )
        .await
    }

    #[tokio::test]
    async fn reads_a_file() {
        let (_guard, dir) = scratch();
        let file = dir.join("a.txt");
        std::fs::write(&file, "hello").unwrap();

        let outcome = read(json!({"path": file.to_string_lossy()})).await.unwrap();

        assert!(outcome.ok);
        assert_eq!(outcome.fields["content"], "hello");
        assert_eq!(outcome.fields["bytes_read"], 5);
        assert_eq!(outcome.fields["truncated"], false);
        assert_eq!(
            outcome.summary,
            format!("Read 5 bytes from {}.", file.display())
        );
    }

    #[tokio::test]
    async fn caps_at_max_bytes_and_says_so() {
        let (_guard, dir) = scratch();
        let file = dir.join("a.txt");
        std::fs::write(&file, "abcdef").unwrap();

        let cut = read(json!({"path": file.to_string_lossy(), "max_bytes": 4}))
            .await
            .unwrap();
        let exact = read(json!({"path": file.to_string_lossy(), "max_bytes": 6}))
            .await
            .unwrap();
        let floor = read(json!({"path": file.to_string_lossy(), "max_bytes": 0}))
            .await
            .unwrap();

        assert_eq!(cut.fields["content"], "abcd");
        assert_eq!(cut.fields["truncated"], true);
        assert!(cut.summary.ends_with("(truncated)."));
        assert_eq!(exact.fields["truncated"], false);
        assert_eq!(floor.fields["content"], "a");
    }

    #[tokio::test]
    async fn strips_a_utf8_bom_and_decodes_windows_1252() {
        let (_guard, dir) = scratch();
        std::fs::write(dir.join("bom"), b"\xEF\xBB\xBFhi").unwrap();
        std::fs::write(dir.join("ansi"), b"caf\xE9").unwrap();

        let bom = read(json!({"path": dir.join("bom").to_string_lossy()}))
            .await
            .unwrap();
        let ansi = read(json!({"path": dir.join("ansi").to_string_lossy()}))
            .await
            .unwrap();

        assert_eq!(bom.fields["content"], "hi");
        assert_eq!(bom.fields["bytes_read"], 5);
        assert_eq!(ansi.fields["content"], "café");
    }

    #[tokio::test]
    async fn refuses_a_directory_a_missing_file_and_a_bad_max_bytes() {
        let (_guard, dir) = scratch();
        std::fs::write(dir.join("f"), "x").unwrap();

        let directory = read(json!({"path": dir.to_string_lossy()}))
            .await
            .unwrap_err();
        assert!(
            directory
                .to_string()
                .ends_with("Use list_directory on it instead.")
        );

        let missing = read(json!({"path": dir.join("nope").to_string_lossy()}))
            .await
            .unwrap_err();
        assert_eq!(
            missing,
            ToolError::refused(format!(
                "`path` {} does not exist.",
                dir.join("nope").display()
            ))
        );

        let bad = read(json!({"path": dir.join("f").to_string_lossy(), "max_bytes": 1.5}))
            .await
            .unwrap_err();
        assert_eq!(
            bad,
            ToolError::refused("`max_bytes` must be an integer, got 1.5.")
        );
    }
}
