//! `list_directory`: list what is in a directory on the host.
use std::sync::Arc;

use rmcp::model::{Tool, ToolAnnotations};
use serde_json::{Value, json};

use crate::config::settings::{Config, MAX_LIST_ENTRIES};
use crate::models::args::optional_bool;
use crate::models::tool::{ToolArgs, ToolFuture, ToolOutcome, ToolSpec, object};
use crate::services::paths::{Expect, resolve_path};

pub const NAME: &str = "list_directory";

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
        "List what is in a directory on the host, with a type marker per entry. Use this to \
         find out what exists before deciding what to run - it is cheaper than a command, \
         and it does not execute anything. Read-only.",
        object(json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory to list. Required - there is no default. Absolute, or relative to the server's own working directory."
                },
                "include_hidden": {
                    "description": "Include dot-prefixed and hidden entries. Default false.",
                    "type": "boolean"
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
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "type": {"type": "string"},
                        "size": {"type": "integer", "minimum": -9007199254740991i64, "maximum": 9007199254740991i64}
                    },
                    "required": ["name", "type", "size"],
                    "additionalProperties": false
                }
            },
            "truncated": {"type": "boolean"}
        },
        "required": ["path", "entries", "truncated"],
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

/// One entry while the listing is being built.
struct Found {
    name: String,
    kind: &'static str,
    size: u64,
    is_file: bool,
}

pub fn handle(config: Arc<Config>, args: ToolArgs) -> ToolFuture {
    Box::pin(async move {
        let target = resolve_path(args.get("path"), &config, Expect::Dir)?;
        let include_hidden = optional_bool(&args, "include_hidden")?.unwrap_or(false);

        let mut found: Vec<Found> = Vec::new();
        let mut reader = tokio::fs::read_dir(&target).await?;
        while let Some(entry) = reader.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !include_hidden && name.starts_with('.') {
                continue;
            }

            // Follows links, as a listing should. A dangling link or a permission wall is an
            // entry, not a failure.
            let (kind, size, is_file) = match tokio::fs::metadata(entry.path()).await {
                Ok(meta) => (
                    if meta.is_dir() { "dir" } else { "file" },
                    meta.len(),
                    meta.is_file(),
                ),
                Err(_) => ("unreadable", 0, false),
            };
            found.push(Found {
                name,
                kind,
                size,
                is_file,
            });
        }

        // Directories first, then files, each group by case-insensitive name.
        found.sort_by_cached_key(|entry| (entry.is_file, entry.name.to_lowercase()));

        let truncated = found.len() > MAX_LIST_ENTRIES;
        let entries: Vec<Value> = found
            .iter()
            .take(MAX_LIST_ENTRIES)
            .map(|entry| json!({"name": entry.name, "type": entry.kind, "size": entry.size}))
            .collect();

        let summary = format!(
            "{} entries in {}{}",
            entries.len(),
            target.display(),
            if truncated { " (listing capped)." } else { "." }
        );

        let fields = json!({
            "path": target.to_string_lossy(),
            "entries": entries,
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
    use crate::utils::errors::ToolError;
    use std::path::PathBuf;

    fn scratch() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        (dir, real)
    }

    async fn list(args: Value) -> Result<ToolOutcome, ToolError> {
        handle(
            Arc::new(Config::default()),
            args.as_object().cloned().unwrap(),
        )
        .await
    }

    fn names(outcome: &ToolOutcome) -> Vec<String> {
        outcome.fields["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn lists_dirs_first_then_files_by_name() {
        let (_guard, dir) = scratch();
        std::fs::create_dir(dir.join("Zeta")).unwrap();
        std::fs::create_dir(dir.join("alpha")).unwrap();
        std::fs::write(dir.join("b.txt"), "abc").unwrap();
        std::fs::write(dir.join("A.txt"), "").unwrap();

        let outcome = list(json!({"path": dir.to_string_lossy()})).await.unwrap();

        assert!(outcome.ok);
        assert_eq!(names(&outcome), ["alpha", "Zeta", "A.txt", "b.txt"]);
        assert_eq!(
            outcome.fields["entries"][3],
            json!({"name": "b.txt", "type": "file", "size": 3})
        );
        assert_eq!(outcome.fields["entries"][0]["type"], "dir");
        assert_eq!(outcome.fields["truncated"], false);
        assert_eq!(outcome.fields["path"], json!(dir.to_string_lossy()));
        assert_eq!(outcome.summary, format!("4 entries in {}.", dir.display()));
    }

    #[tokio::test]
    async fn hides_dot_entries_unless_asked() {
        let (_guard, dir) = scratch();
        std::fs::write(dir.join(".hidden"), "").unwrap();
        std::fs::write(dir.join("shown"), "").unwrap();

        let plain = list(json!({"path": dir.to_string_lossy()})).await.unwrap();
        let all = list(json!({"path": dir.to_string_lossy(), "include_hidden": true}))
            .await
            .unwrap();

        assert_eq!(names(&plain), ["shown"]);
        assert_eq!(names(&all), [".hidden", "shown"]);
    }

    #[tokio::test]
    async fn caps_a_long_listing() {
        let (_guard, dir) = scratch();
        for index in 0..MAX_LIST_ENTRIES + 3 {
            std::fs::write(dir.join(format!("f{index:04}")), "").unwrap();
        }

        let outcome = list(json!({"path": dir.to_string_lossy()})).await.unwrap();

        assert_eq!(names(&outcome).len(), MAX_LIST_ENTRIES);
        assert_eq!(outcome.fields["truncated"], true);
        assert!(outcome.summary.ends_with("(listing capped)."));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_dangling_link_is_an_unreadable_entry() {
        let (_guard, dir) = scratch();
        std::os::unix::fs::symlink(dir.join("gone"), dir.join("dangling")).unwrap();

        let outcome = list(json!({"path": dir.to_string_lossy()})).await.unwrap();

        assert_eq!(
            outcome.fields["entries"][0],
            json!({"name": "dangling", "type": "unreadable", "size": 0})
        );
    }

    #[tokio::test]
    async fn refuses_a_file_a_missing_path_and_a_bad_flag() {
        let (_guard, dir) = scratch();
        std::fs::write(dir.join("f"), "").unwrap();

        let file = list(json!({"path": dir.join("f").to_string_lossy()}))
            .await
            .unwrap_err();
        assert!(file.to_string().ends_with("is a file, not a directory."));

        assert!(matches!(list(json!({})).await, Err(ToolError::Refused(_))));

        let flag = list(json!({"path": dir.to_string_lossy(), "include_hidden": "yes"}))
            .await
            .unwrap_err();
        assert_eq!(
            flag,
            ToolError::refused("`include_hidden` must be a boolean, got string.")
        );
    }
}
