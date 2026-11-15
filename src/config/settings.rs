//! Every knob this server has, in one place.
//!
//! The limits are constants. The settings the command line may change live in [`Config`], which
//! `main` builds once from the flags and shares, read-only, with every handler.
use std::path::PathBuf;

/// The ceiling a model cannot argue its way past, in seconds.
pub const MAX_TIMEOUT: f64 = 600.0;

/// Seconds. Used when neither the call nor `--timeout` names one; long enough for a build step.
pub const DEFAULT_TIMEOUT: f64 = 30.0;

/// Characters. Past this the model reasons about a partial result as though it were complete.
pub const MAX_OUTPUT: usize = 30_000;

/// A listing is for orientation, not for transfer.
pub const MAX_LIST_ENTRIES: usize = 500;

/// Bytes. A file is read to be looked at, not ingested.
pub const MAX_FILE_BYTES: u64 = 200_000;

/// The settings the command line may change.
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    /// Optional confinement boundary, as an absolute resolved path. `None` means nothing is
    /// confined, which is the default: `cmd` is a free-form shell string, so bounding `path`
    /// would limit where a command *starts* while leaving where it *goes* wide open. A boundary
    /// that reads as a guarantee it cannot keep is worse than no boundary at all.
    ///
    /// There is deliberately no default value and no fallback directory - the server has no
    /// opinion about where your code lives. Pass `--confine <dir>` to impose one.
    pub confine_root: Option<PathBuf>,

    /// Lowercase executable names. Empty means every executable may run; populate to narrow.
    pub allowed_executables: Vec<String>,

    /// Seconds. Used when a call does not pass `timeout`.
    pub default_timeout: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            confine_root: None,
            allowed_executables: Vec::new(),
            default_timeout: DEFAULT_TIMEOUT,
        }
    }
}
