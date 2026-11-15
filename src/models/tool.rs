//! The shape every tool module shares: its MCP definition, the arguments its handler receives,
//! and the outcome the handler resolves to.
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use rmcp::model::Tool;
use serde_json::{Map, Value};

use crate::config::settings::Config;
use crate::utils::errors::ToolError;

/// A call's arguments as the handler sees them: the raw JSON object. Each handler checks what it
/// reads and refuses what it cannot use, rather than trusting the schema alone.
pub type ToolArgs = Map<String, Value>;

/// What a handler returns: a one-line summary for the model, the fields to report, and whether
/// the call succeeded. `ok` false marks the call as an error without dropping its payload.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutcome {
    pub summary: String,
    pub fields: Map<String, Value>,
    pub ok: bool,
}

/// A handler's eventual result.
pub type ToolFuture = Pin<Box<dyn Future<Output = Result<ToolOutcome, ToolError>> + Send>>;

/// A tool's handler. It owns its inputs so the call can run on its own task.
pub type ToolHandler = fn(Arc<Config>, ToolArgs) -> ToolFuture;

/// A module in `src/controllers/` that is a tool.
#[derive(Clone, Copy)]
pub struct ToolSpec {
    /// The tool's name, which is also its module's file name.
    pub name: &'static str,
    /// What `tools/list` advertises.
    pub definition: fn() -> Tool,
    pub handle: ToolHandler,
}

/// A JSON object from a literal. Panics on anything else, which only a typo in a schema literal
/// in `src/controllers/` can cause, and the registry tests build every one.
pub fn object(value: Value) -> Arc<Map<String, Value>> {
    match value {
        Value::Object(map) => Arc::new(map),
        other => panic!("a schema must be a JSON object, got {other}"),
    }
}
