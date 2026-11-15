//! The MCP server: protocol and tool dispatch only.
//!
//! The tool surface is not written here - it is whatever `controllers` registers.
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler};
use serde_json::{Map, Value};

use crate::config::settings::Config;
use crate::config::version::{SERVER_NAME, VERSION};
use crate::controllers::Registry;
use crate::models::tool::{ToolArgs, ToolSpec};
use crate::utils::errors::ToolError;
use crate::utils::log::log;
use crate::utils::render::render_result;

/// Shape a handler's outcome into a `tools/call` result.
///
/// `isError` is how a client learns a command failed. It carries the message, so a failure
/// arrives as readable data rather than as an opaque protocol error.
///
/// The text block is what the model actually reads (see `utils::render`). Everything also rides
/// along in `structuredContent` for a client that would rather read it programmatically - except
/// on a refusal or a crash, which have no fields to report. A client validates
/// `structuredContent` against the tool's output schema whenever it is present, so an empty
/// object there would be rejected for the fields it lacks.
///
/// `message` is the reason, for a refusal or a handler crash; empty otherwise.
pub fn tool_result(
    summary: &str,
    fields: Map<String, Value>,
    ok: bool,
    message: &str,
) -> CallToolResult {
    let body = render_result(summary, &fields, message);
    let content = vec![ContentBlock::text(body)];
    let mut result = if ok {
        CallToolResult::success(content)
    } else {
        CallToolResult::error(content)
    };
    if message.is_empty() {
        result.structured_content = Some(Value::Object(fields));
    }
    result
}

/// The text of a panic, when it carried one.
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    match payload.downcast::<String>() {
        Ok(text) => *text,
        Err(payload) => match payload.downcast::<&'static str>() {
            Ok(text) => (*text).to_string(),
            Err(_) => "the handler panicked".to_string(),
        },
    }
}

/// The host CLI server. Cheap to clone: the settings and the registry are shared.
#[derive(Clone)]
pub struct HostCli {
    config: Arc<Config>,
    registry: Arc<Registry>,
}

impl HostCli {
    /// A server for the built-in tools.
    pub fn new(config: Config) -> Self {
        Self::with_registry(config, Registry::builtin())
    }

    /// A server for another set of tools; for tests.
    pub fn with_registry(config: Config, registry: Registry) -> Self {
        Self {
            config: Arc::new(config),
            registry: Arc::new(registry),
        }
    }

    /// Run one tool call, turning every failure into a result the client can read.
    ///
    /// The handler runs on its own task, so a panic in it is caught there and reported as an
    /// internal error, and the server carries on serving.
    pub async fn call(&self, name: &str, args: ToolArgs) -> CallToolResult {
        let Some(spec) = self.registry.get(name).copied() else {
            return tool_result(
                "Refused",
                Map::new(),
                false,
                &format!("Tool {name} not found."),
            );
        };
        let ToolSpec { handle, .. } = spec;

        let outcome = match tokio::spawn(handle(Arc::clone(&self.config), args)).await {
            Ok(outcome) => outcome,
            Err(joined) => Err(ToolError::Internal {
                kind: "Panic".to_string(),
                message: if joined.is_panic() {
                    panic_message(joined.into_panic())
                } else {
                    "the handler was cancelled".to_string()
                },
            }),
        };

        match outcome {
            Ok(outcome) => tool_result(&outcome.summary, outcome.fields, outcome.ok, ""),
            Err(ToolError::Refused(message)) => tool_result("Refused", Map::new(), false, &message),
            Err(crash) => {
                log(&format!("Handler crashed:\n{crash}"));
                tool_result("Internal Error", Map::new(), false, &crash.to_string())
            }
        }
    }

    /// What `tools/list` advertises.
    pub fn tool_list(&self) -> Vec<Tool> {
        self.registry
            .tools()
            .iter()
            .map(|spec| (spec.definition)())
            .collect()
    }
}

impl ServerHandler for HostCli {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_tool_list_changed()
                .build(),
        )
        .with_server_info(Implementation::new(SERVER_NAME, VERSION))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tool_list()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let args = request.arguments.unwrap_or_default();
        Ok(self.call(&request.name, args).await.into())
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.registry.get(name).map(|spec| (spec.definition)())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text(result: &CallToolResult) -> String {
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

    #[test]
    fn tool_result_renders_and_carries_fields_unless_refused() {
        let fields = json!({"stdout": "", "stderr": ""})
            .as_object()
            .cloned()
            .unwrap();
        let ok = tool_result("S", fields.clone(), true, "");
        assert_eq!(text(&ok), "**S**\n\n_(no output)_\n");
        assert_eq!(ok.is_error, Some(false));
        assert_eq!(ok.structured_content, Some(Value::Object(fields)));

        let refused = tool_result("Refused", Map::new(), false, "why");
        assert_eq!(text(&refused), "**Refused**\n\nwhy");
        assert_eq!(refused.is_error, Some(true));
        assert_eq!(refused.structured_content, None);
    }

    #[tokio::test]
    async fn an_unknown_tool_is_an_error_result() {
        let server = HostCli::new(Config::default());
        let result = server.call("no_such_tool", Map::new()).await;
        assert_eq!(result.is_error, Some(true));
        assert_eq!(text(&result), "**Refused**\n\nTool no_such_tool not found.");
    }
}
