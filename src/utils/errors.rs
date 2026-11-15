//! Why a tool call did not produce a payload.
use std::fmt;

/// A handler's failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolError {
    /// A request the owner would not want served. Carries a message worth reading.
    Refused(String),
    /// Something the handler did not expect: a bug, or the host failing under it. `kind` names
    /// the failure (an I/O error kind, or `Panic`), `message` says what happened.
    Internal { kind: String, message: String },
}

impl ToolError {
    pub fn refused(message: impl Into<String>) -> Self {
        Self::Refused(message.into())
    }
}

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(message) => f.write_str(message),
            Self::Internal { kind, message } => write!(f, "{kind}: {message}"),
        }
    }
}

impl std::error::Error for ToolError {}

impl From<std::io::Error> for ToolError {
    fn from(error: std::io::Error) -> Self {
        Self::Internal {
            kind: format!("{:?}", error.kind()),
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn displays_the_reason() {
        assert_eq!(ToolError::refused("no").to_string(), "no");
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        assert_eq!(ToolError::from(io).to_string(), "PermissionDenied: denied");
    }
}
