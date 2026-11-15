//! Where a tool may act: real-path resolution and the `--confine` check.
use std::io;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

use crate::config::settings::Config;
use crate::models::args::type_name;
use crate::utils::errors::ToolError;

/// What [`resolve_path`] requires of what it finds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expect {
    /// Refuse a path that is missing or is not a directory.
    Dir,
    /// Take the path as it resolves; the caller checks what is there.
    Any,
}

/// `path` made absolute against `base` and normalised lexically: `.` dropped, `..` applied.
/// Nothing on disk is read.
pub fn absolute(base: &Path, path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in base.join(path).components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                out.push(component.as_os_str())
            }
            Component::CurDir => {}
            Component::ParentDir => {
                // At the root, `..` stays at the root, as it does on every platform.
                if out.parent().is_some() {
                    out.pop();
                }
            }
        }
    }
    out
}

/// Resolve a path the way a non-strict realpath does: follow links through the part that exists
/// and keep the rest literal.
///
/// A strict realpath fails on a path that does not exist yet, which would make "does not exist"
/// indistinguishable from "outside the root" for a path that is both. Walking up to the nearest
/// existing ancestor keeps the confinement check meaningful either way.
///
/// `path` must be absolute.
pub fn resolve_real(path: &Path) -> io::Result<PathBuf> {
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path.to_path_buf();

    loop {
        match dunce::canonicalize(&current) {
            Ok(real) => {
                let mut resolved = real;
                for part in rest.iter().rev() {
                    resolved.push(part);
                }
                return Ok(resolved);
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) =>
            {
                let (Some(parent), Some(name)) = (current.parent(), current.file_name()) else {
                    return Err(error);
                };
                rest.push(name.to_os_string());
                current = parent.to_path_buf();
            }
            Err(error) => return Err(error),
        }
    }
}

/// Resolve the required `path` argument into a usable absolute path.
///
/// `path` is required on every tool. There is no default directory: the server has no opinion
/// about where your code lives, and guessing one is how a tool ends up writing somewhere you did
/// not ask for. A relative path is resolved against the server process's own working directory,
/// which is where the client started it.
///
/// When the server was started with `--confine <dir>`, resolving through real paths is what makes
/// the check real: it collapses `..` and follows symlinks, so neither traversal nor a link out of
/// the tree gets past it.
pub fn resolve_path(
    raw: Option<&Value>,
    config: &Config,
    expect: Expect,
) -> Result<PathBuf, ToolError> {
    let raw = match raw {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) if text.trim().is_empty() => None,
        Some(Value::String(text)) => Some(text.as_str()),
        Some(other) => {
            return Err(ToolError::refused(format!(
                "`path` must be a string, got {}.",
                type_name(other)
            )));
        }
    };
    let Some(raw) = raw else {
        return Err(ToolError::refused(
            "`path` is required and must be a non-empty string. There is no default; pass one explicitly.",
        ));
    };

    let cwd = std::env::current_dir()?;
    let resolved = resolve_real(&absolute(&cwd, Path::new(raw)))?;

    if let Some(root) = &config.confine_root
        && !resolved.starts_with(root)
    {
        return Err(ToolError::refused(format!(
            "`path` resolved to {}, which is outside the allowed root {}. \
             Pass a path inside the root, or restart the server without --confine.",
            resolved.display(),
            root.display()
        )));
    }

    if expect == Expect::Dir {
        match std::fs::metadata(&resolved) {
            Err(_) => {
                return Err(ToolError::refused(format!(
                    "`path` {} does not exist.",
                    resolved.display()
                )));
            }
            Ok(meta) if !meta.is_dir() => {
                return Err(ToolError::refused(format!(
                    "`path` {} is a file, not a directory.",
                    resolved.display()
                )));
            }
            Ok(_) => {}
        }
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        (dir, real)
    }

    fn confined(root: &Path) -> Config {
        Config {
            confine_root: Some(root.to_path_buf()),
            ..Config::default()
        }
    }

    #[test]
    fn absolute_normalises_lexically() {
        let base = Path::new("/a/b");
        assert_eq!(
            absolute(base, Path::new("c/../d/./e")),
            PathBuf::from("/a/b/d/e")
        );
        assert_eq!(absolute(base, Path::new("/x/../../y")), PathBuf::from("/y"));
    }

    #[test]
    fn resolve_real_keeps_the_missing_tail_literal() {
        let (_guard, dir) = scratch();
        let path = dir.join("missing").join("deeper");
        assert_eq!(resolve_real(&path).unwrap(), path);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_real_follows_links() {
        let (_guard, dir) = scratch();
        std::fs::create_dir(dir.join("real")).unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("link")).unwrap();
        assert_eq!(
            resolve_real(&dir.join("link").join("x")).unwrap(),
            dir.join("real").join("x")
        );
    }

    #[test]
    fn requires_a_non_empty_string() {
        let config = Config::default();
        for raw in [None, Some(json!(null)), Some(json!("  "))] {
            let error = resolve_path(raw.as_ref(), &config, Expect::Dir).unwrap_err();
            assert!(
                error.to_string().starts_with("`path` is required"),
                "{error}"
            );
        }
        assert_eq!(
            resolve_path(Some(&json!(5)), &config, Expect::Dir).unwrap_err(),
            ToolError::refused("`path` must be a string, got number.")
        );
    }

    #[test]
    fn refuses_a_missing_dir_or_a_file() {
        let (_guard, dir) = scratch();
        std::fs::write(dir.join("f"), "x").unwrap();
        let config = Config::default();

        let missing = json!(dir.join("nope").to_string_lossy());
        let error = resolve_path(Some(&missing), &config, Expect::Dir).unwrap_err();
        assert!(error.to_string().ends_with("does not exist."), "{error}");

        let file = json!(dir.join("f").to_string_lossy());
        let error = resolve_path(Some(&file), &config, Expect::Dir).unwrap_err();
        assert!(
            error.to_string().ends_with("is a file, not a directory."),
            "{error}"
        );
        assert_eq!(
            resolve_path(Some(&file), &config, Expect::Any).unwrap(),
            dir.join("f")
        );
    }

    #[test]
    fn confinement_refuses_traversal_and_allows_inside() {
        let (_guard, dir) = scratch();
        let root = dir.join("root");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let config = confined(&root);

        let inside = json!(root.join("sub").to_string_lossy());
        assert_eq!(
            resolve_path(Some(&inside), &config, Expect::Dir).unwrap(),
            root.join("sub")
        );

        let escape = json!(root.join("..").to_string_lossy());
        let error = resolve_path(Some(&escape), &config, Expect::Dir).unwrap_err();
        assert!(
            error.to_string().contains("outside the allowed root"),
            "{error}"
        );

        // A sibling sharing the root's name as a prefix is still outside.
        std::fs::create_dir(dir.join("rootless")).unwrap();
        let sibling = json!(dir.join("rootless").to_string_lossy());
        assert!(resolve_path(Some(&sibling), &config, Expect::Dir).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn confinement_refuses_a_link_out_of_the_root() {
        let (_guard, dir) = scratch();
        let root = dir.join("root");
        std::fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink(&dir, root.join("out")).unwrap();

        let link = json!(root.join("out").to_string_lossy());
        let error = resolve_path(Some(&link), &confined(&root), Expect::Dir).unwrap_err();
        assert!(
            error.to_string().contains("outside the allowed root"),
            "{error}"
        );
    }
}
