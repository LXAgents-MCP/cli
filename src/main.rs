//! Server entry point.
//!
//! Exposes the host command line to an LLM over MCP. A model's sandbox cannot reach the shell, so
//! this server runs *outside* it - spawned by the MCP client as an ordinary host subprocess - and
//! runs commands on the owner's behalf. Register it in `claude_desktop_config.json`:
//!
//! ```json
//! {"mcpServers": {"host-cli": {"command": "<path to lxagents-cli>"}}}
//! ```
//!
//! The boundary, stated plainly: there isn't one by default. `path` is required on every tool and
//! may name any directory on the machine, and `cmd` is a free-form shell string, so a command runs
//! wherever it is told to. What remains configurable is not a boundary but a *policy*: `--confine`
//! refuses any `path` that resolves outside the given directory, and `--allow` narrows which
//! executable may run at all. Both are off, because the owner asked for free host access.
//!
//! Stdio is the only transport, on purpose. Free-form shell execution must never be reachable over
//! a network, so there is no HTTP transport here and no token to configure.
//!
//! Lifetime: the process lives until its stdin closes or the client goes away. A command that
//! outlives its timeout is reported as a timeout and the server carries on serving.
//!
//! Nothing here may write to stdout: on stdio, stdout is the JSON-RPC channel.
#![forbid(unsafe_code)]

use std::path::Path;
use std::process::ExitCode;

use lxagents_cli::config::options::{USAGE, parse_options};
use lxagents_cli::config::settings::Config;
use lxagents_cli::config::version::{SERVER_NAME, VERSION};
use lxagents_cli::routes::server::HostCli;
use lxagents_cli::services::paths::{absolute, resolve_real};
use lxagents_cli::utils::log::log;
use rmcp::ServiceExt;
use rmcp::service::ServerInitializeError;
use rmcp::transport::stdio;

#[tokio::main]
async fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();

    let options = match parse_options(&argv) {
        Ok(options) => options,
        Err(error) => {
            log(&format!("{error}\n\n{USAGE}"));
            return ExitCode::from(2);
        }
    };

    if options.help {
        log(USAGE);
        return ExitCode::SUCCESS;
    }

    // The one place the command line reaches the settings.
    let mut config = Config::default();
    if let Some(dir) = &options.confine {
        let resolved =
            std::env::current_dir().and_then(|cwd| resolve_real(&absolute(&cwd, Path::new(dir))));
        match resolved {
            Ok(root) => config.confine_root = Some(root),
            Err(error) => {
                log(&format!("--confine {dir}: {error}"));
                return ExitCode::FAILURE;
            }
        }
    }
    if let Some(allow) = options.allow {
        config.allowed_executables = allow;
    }
    if let Some(timeout) = options.timeout {
        config.default_timeout = timeout;
    }

    // The transport is the process's own stdin and stdout, ready as soon as it is wrapped.
    log(&format!("{SERVER_NAME} {VERSION} serving over stdio"));
    let service = match HostCli::new(config).serve(stdio()).await {
        Ok(service) => service,
        // The client went away before the handshake: the same quiet end as any other close.
        Err(ServerInitializeError::ConnectionClosed(_)) => return ExitCode::SUCCESS,
        Err(error) => {
            log(&format!("{SERVER_NAME} failed to start: {error}"));
            return ExitCode::FAILURE;
        }
    };

    tokio::select! {
        _ = service.waiting() => ExitCode::SUCCESS,
        _ = tokio::signal::ctrl_c() => {
            // stdin is read on a blocking thread that would hold the runtime open; exit outright.
            std::process::exit(0);
        }
    }
}
