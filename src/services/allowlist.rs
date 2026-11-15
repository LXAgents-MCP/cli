//! Which executable a command line starts, and the `--allow` check on it.
use crate::config::settings::Config;
use crate::utils::errors::ToolError;

/// The executable in a command line, for the allowlist check.
///
/// Best effort by nature - a shell line can build its executable any number of ways - which is
/// why the allowlist is a narrowing measure and not a boundary. The name is the file stem of the
/// first token, lowercased, so `"C:\Tools\Git.exe" status` and `git status` both read `git`.
/// Both path separators are understood on every platform, so a Windows path in an allowlisted
/// command reads the same on a POSIX host.
pub fn first_token(command: &str) -> String {
    let text = command.trim_start();

    let token = match text.chars().next() {
        Some(quote @ ('"' | '\'')) => {
            let inner = &text[1..];
            match inner.find(quote) {
                Some(end) => &inner[..end],
                None => inner,
            }
        }
        _ => text.split(char::is_whitespace).next().unwrap_or_default(),
    };

    file_stem(token).to_lowercase()
}

/// The file name without its last extension, the way Node's `path.win32.parse(...).name` reads it.
fn file_stem(token: &str) -> &str {
    // A drive designator such as `C:` is not part of the name.
    let bytes = token.as_bytes();
    let token = if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        &token[2..]
    } else {
        token
    };

    let trimmed = token.trim_end_matches(['/', '\\']);
    let base = match trimmed.rfind(['/', '\\']) {
        Some(at) => &trimmed[at + 1..],
        None => trimmed,
    };

    match base.rfind('.') {
        Some(dot) if dot > 0 && base != ".." => &base[..dot],
        _ => base,
    }
}

/// Refuse a command whose executable is not allowed, when an allowlist is set.
pub fn check_allowlist(command: &str, config: &Config) -> Result<(), ToolError> {
    if config.allowed_executables.is_empty() {
        return Ok(());
    }

    let token = first_token(command);
    if !config.allowed_executables.contains(&token) {
        let mut allowed = config.allowed_executables.clone();
        allowed.sort();
        return Err(ToolError::refused(format!(
            "`cmd` starts with '{token}', which is not in the allowlist. Allowed: {}.",
            allowed.join(", ")
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_executable_name() {
        assert_eq!(first_token("git status"), "git");
        assert_eq!(first_token("   NPM run build"), "npm");
        assert_eq!(
            first_token("\"C:\\Program Files\\Git\\bin\\Git.exe\" status"),
            "git"
        );
        assert_eq!(first_token("'/usr/bin/node' -v"), "node");
        assert_eq!(first_token("C:\\Tools\\python3.12.exe x"), "python3.12");
        assert_eq!(first_token("\"unterminated"), "unterminated");
        assert_eq!(first_token(".bashrc"), ".bashrc");
        assert_eq!(first_token(""), "");
    }

    #[test]
    fn checks_only_when_an_allowlist_is_set() {
        let open = Config::default();
        assert!(check_allowlist("rm -rf /", &open).is_ok());

        let narrowed = Config {
            allowed_executables: vec!["npm".to_string(), "git".to_string()],
            ..Config::default()
        };
        assert!(check_allowlist("git status", &narrowed).is_ok());
        assert_eq!(
            check_allowlist("node -v", &narrowed).unwrap_err(),
            ToolError::refused(
                "`cmd` starts with 'node', which is not in the allowlist. Allowed: git, npm."
            )
        );
    }
}
