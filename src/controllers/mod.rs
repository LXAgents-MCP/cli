//! Tool registry: one module per tool, named after the tool.
//!
//! Adding a tool is a new file in this directory, named after the tool, that exposes
//! `spec() -> ToolSpec` (its definition and handler, typed by `models::tool`), plus one line in
//! [`MODULES`]. Nothing needs editing elsewhere - `routes::server` never names a tool, so the
//! protocol layer cannot grow a per-tool special case. A test fails if a file here is not in
//! [`MODULES`], so a module dropped here is never silently left out - but helpers belong in
//! `services/` or `utils/`, not here.
use std::collections::HashSet;

use crate::models::tool::ToolSpec;

pub mod list_directory;
pub mod read_file;
pub mod run_command;

/// Every tool module, in the order `tools/list` advertises them.
pub const MODULES: &[fn() -> ToolSpec] =
    &[list_directory::spec, read_file::spec, run_command::spec];

/// The tools this server serves, checked once at startup.
#[derive(Clone)]
pub struct Registry {
    tools: Vec<ToolSpec>,
}

impl Registry {
    /// A registry of `tools`. Two tools answering to one name make `tools/call` dispatch
    /// arbitrary, so that fails here, loudly, rather than silently at call time.
    pub fn new(tools: Vec<ToolSpec>) -> Result<Self, String> {
        let mut seen = HashSet::new();
        for spec in &tools {
            if spec.name.is_empty() {
                return Err("A tool has no name.".to_string());
            }
            if (spec.definition)().name != spec.name {
                return Err(format!("Tool '{}' advertises a different name.", spec.name));
            }
            if !seen.insert(spec.name) {
                return Err(format!("Duplicate tool name '{}'.", spec.name));
            }
        }
        Ok(Self { tools })
    }

    /// The tools in [`MODULES`].
    pub fn builtin() -> Self {
        Self::new(MODULES.iter().map(|spec| spec()).collect())
            .expect("the built-in tool modules are consistent")
    }

    pub fn get(&self, name: &str) -> Option<&ToolSpec> {
        self.tools.iter().find(|spec| spec.name == name)
    }

    pub fn tools(&self) -> &[ToolSpec] {
        &self.tools
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::tool::{ToolArgs, ToolFuture};
    use std::sync::Arc;

    #[test]
    fn serves_the_three_tools() {
        let registry = Registry::builtin();
        let names: Vec<&str> = registry.tools().iter().map(|spec| spec.name).collect();
        assert_eq!(names, ["list_directory", "read_file", "run_command"]);
        assert!(registry.get("read_file").is_some());
        assert!(registry.get("nope").is_none());
    }

    #[test]
    fn every_module_in_this_directory_is_registered() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/controllers");
        let mut files: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".rs") && name != "mod.rs")
            .map(|name| name.trim_end_matches(".rs").to_string())
            .collect();
        files.sort();

        let mut registered: Vec<String> = Registry::builtin()
            .tools()
            .iter()
            .map(|spec| spec.name.to_string())
            .collect();
        registered.sort();

        assert_eq!(
            files, registered,
            "each file in src/controllers/ is one tool, named after the file"
        );
    }

    #[test]
    fn every_definition_has_schemas_and_a_description() {
        for spec in Registry::builtin().tools() {
            let tool = (spec.definition)();
            assert_eq!(
                tool.input_schema.get("type"),
                Some(&serde_json::json!("object"))
            );
            assert!(
                tool.output_schema.is_some(),
                "{} has no output schema",
                spec.name
            );
            assert!(tool.description.unwrap_or_default().len() > 20);
            assert!(tool.annotations.is_some());
        }
    }

    fn noop(_: Arc<crate::config::settings::Config>, _: ToolArgs) -> ToolFuture {
        Box::pin(async { unreachable!() })
    }

    #[test]
    fn refuses_duplicate_and_mismatched_names() {
        let twice = vec![list_directory::spec(), list_directory::spec()];
        assert_eq!(
            Registry::new(twice).err().unwrap(),
            "Duplicate tool name 'list_directory'."
        );

        let renamed = ToolSpec {
            name: "other",
            definition: list_directory::definition,
            handle: noop,
        };
        assert!(Registry::new(vec![renamed]).is_err());

        let unnamed = ToolSpec {
            name: "",
            definition: list_directory::definition,
            handle: noop,
        };
        assert_eq!(
            Registry::new(vec![unnamed]).err().unwrap(),
            "A tool has no name."
        );
    }
}
