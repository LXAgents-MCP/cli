//! The text block of a tool result: what the model actually reads.
use serde_json::{Map, Value};

/// Render a result per its shape: a command gets its two streams, a listing gets the entries, a
/// file gets its content, and a refusal gets the sentence explaining it.
///
/// `message` is the reason, for a refusal or a handler bug; empty otherwise.
pub fn render_result(summary: &str, fields: &Map<String, Value>, message: &str) -> String {
    if !message.is_empty() {
        // A refusal or a handler bug: there is nothing to render but the reason.
        let summary = if summary.is_empty() {
            "Refused"
        } else {
            summary
        };
        return format!("**{summary}**\n\n{message}");
    }

    if let Some(stdout) = fields.get("stdout") {
        let stdout = stdout.as_str().unwrap_or_default();
        let stderr = fields
            .get("stderr")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut body = format!("**{summary}**\n\n");
        if !stdout.is_empty() {
            body.push_str(&format!("```\n{stdout}\n```\n"));
        }
        if !stderr.is_empty() {
            body.push_str(&format!("\n**stderr**\n\n```\n{stderr}\n```\n"));
        }
        if stdout.is_empty() && stderr.is_empty() {
            body.push_str("_(no output)_\n");
        }
        return body;
    }

    if let Some(entries) = fields.get("entries") {
        let lines: Vec<String> = entries
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|entry| {
                let name = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if entry.get("type").and_then(Value::as_str) == Some("dir") {
                    format!("- `{name}`/")
                } else {
                    let size = entry
                        .get("size")
                        .and_then(Value::as_u64)
                        .unwrap_or_default();
                    format!("- `{name}`  ({size} bytes)")
                }
            })
            .collect();
        let body = if lines.is_empty() {
            "_(empty)_".to_string()
        } else {
            lines.join("\n")
        };
        return format!("**{summary}**\n\n{body}");
    }

    if let Some(content) = fields.get("content") {
        let content = content.as_str().unwrap_or_default();
        return format!("**{summary}**\n\n```text\n{content}\n```\n");
    }

    format!("**{summary}**")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fields(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn renders_each_shape() {
        assert_eq!(
            render_result("S", &fields(json!({"stdout": "", "stderr": ""})), ""),
            "**S**\n\n_(no output)_\n"
        );
        assert_eq!(
            render_result("S", &fields(json!({"stdout": "o", "stderr": "e"})), ""),
            "**S**\n\n```\no\n```\n\n**stderr**\n\n```\ne\n```\n"
        );
        assert_eq!(
            render_result("S", &fields(json!({"entries": []})), ""),
            "**S**\n\n_(empty)_"
        );
        assert_eq!(
            render_result(
                "S",
                &fields(
                    json!({"entries": [{"name": "d", "type": "dir", "size": 0}, {"name": "f", "type": "file", "size": 3}]})
                ),
                ""
            ),
            "**S**\n\n- `d`/\n- `f`  (3 bytes)"
        );
        assert_eq!(
            render_result("S", &fields(json!({"content": "hi"})), ""),
            "**S**\n\n```text\nhi\n```\n"
        );
        assert_eq!(render_result("S", &Map::new(), ""), "**S**");
        assert_eq!(render_result("Boom", &Map::new(), "why"), "**Boom**\n\nwhy");
        assert_eq!(render_result("", &Map::new(), "why"), "**Refused**\n\nwhy");
    }
}
