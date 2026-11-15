//! Running a shell command on the host: spawning it, collecting its output, and killing its whole
//! process tree when it outruns its timeout.
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

/// What a finished or killed command left behind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResult {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// The exit code, or -1 when the command was killed, died by a signal, or never started.
    pub exit_code: i64,
    pub timed_out: bool,
}

/// How long, after the kill, to wait for the pipes to drain before giving up on them.
const DRAIN: Duration = Duration::from_secs(5);

/// The host shell, running `command`: `/bin/sh -c` on POSIX, `cmd.exe /d /s /c` on Windows.
fn shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut shell =
            Command::new(std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()));
        // The same quoting Node's `shell: true` used: the whole line, quoted once, unescaped.
        shell.raw_arg(format!("/d /s /c \"{command}\""));
        shell
    }
    #[cfg(not(windows))]
    {
        let mut shell = Command::new("/bin/sh");
        shell.arg("-c").arg(command);
        shell
    }
}

/// Kill a command and everything it spawned.
///
/// Necessary because the shell starts the real work as a child. Killing only the shell leaves that
/// grandchild running, still holding the stdout pipe - so the read would block until the orphan
/// finishes anyway, and a "2 second" timeout could come back twenty seconds later.
///
/// Windows has no process groups to signal, so `taskkill /T` walks the tree. Elsewhere the child
/// was started as its own group leader, and the whole group is signalled.
///
/// `pid` is taken at spawn: once the shell has exited and been reaped, `Child::id` is gone, but
/// its group may live on in a background job still holding a pipe.
fn kill_tree(child: &mut Child, pid: Option<u32>) {
    let Some(pid) = pid else { return };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let killed = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|status| status.success());
        // taskkill's failure is not interesting: the plain kill is the fallback.
        if !killed {
            let _ = child.start_kill();
        }
    }
    #[cfg(not(windows))]
    {
        use nix::sys::signal::{Signal, killpg};
        use nix::unistd::Pid;
        let Ok(raw) = i32::try_from(pid) else { return };
        if killpg(Pid::from_raw(raw), Signal::SIGKILL).is_err() {
            let _ = child.start_kill();
        }
    }
}

/// Read a pipe to its end into a buffer that stays readable if the read is abandoned.
fn collect<R: AsyncRead + Unpin + Send + 'static>(
    pipe: Option<R>,
) -> (Arc<Mutex<Vec<u8>>>, JoinHandle<()>) {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&buffer);
    let task = tokio::spawn(async move {
        let Some(mut pipe) = pipe else { return };
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => sink
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .extend_from_slice(&chunk[..read]),
            }
        }
    });
    (buffer, task)
}

fn take(buffer: &Mutex<Vec<u8>>) -> Vec<u8> {
    std::mem::take(
        &mut *buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
}

/// Run `command` in `cwd`, returning its output and exit code once it ends or is killed.
///
/// stdin is closed rather than inherited. This process's stdin is the protocol channel, and a
/// child that inherited it could read the client's next message or sit waiting on input that
/// never comes until the timeout kills it.
///
/// The command counts as finished when it has exited *and* both pipes have closed, so a
/// background process still holding a pipe keeps the call waiting until the timeout, as in 4.x.
pub async fn run(command: &str, cwd: &Path, timeout_seconds: f64) -> RunResult {
    let mut shell = shell(command);
    shell
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    shell.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    #[cfg(not(windows))]
    shell.process_group(0);

    let mut child = match shell.spawn() {
        Ok(child) => child,
        Err(error) => {
            return RunResult {
                stdout: Vec::new(),
                stderr: format!("{error}\n").into_bytes(),
                exit_code: -1,
                timed_out: false,
            };
        }
    };

    let pid = child.id();
    let (stdout, mut out_task) = collect(child.stdout.take());
    let (stderr, mut err_task) = collect(child.stderr.take());

    let limit = Duration::try_from_secs_f64(timeout_seconds).unwrap_or(Duration::MAX);
    let finished = tokio::time::timeout(limit, async {
        let status = child.wait().await;
        let _ = (&mut out_task).await;
        let _ = (&mut err_task).await;
        status
    })
    .await;

    let (exit_code, timed_out) = match finished {
        Ok(Ok(status)) => (status.code().map_or(-1, i64::from), false),
        Ok(Err(error)) => {
            stderr
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .extend_from_slice(format!("{error}\n").as_bytes());
            (-1, false)
        }
        Err(_) => {
            // Report the timeout rather than failing silently: a caller that waited 30 seconds
            // deserves to know the command was killed and not merely that nothing came back.
            kill_tree(&mut child, pid);
            // Whatever the command printed before it died is kept, so a timeout does not also
            // throw away the build output that explains why it hung. If a survivor still holds a
            // pipe, stop waiting for it.
            let drained = tokio::time::timeout(DRAIN, async {
                let _ = child.wait().await;
                let _ = (&mut out_task).await;
                let _ = (&mut err_task).await;
            })
            .await;
            if drained.is_err() {
                out_task.abort();
                err_task.abort();
            }
            (-1, true)
        }
    };

    RunResult {
        stdout: take(&stdout),
        stderr: take(&stderr),
        exit_code,
        timed_out,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Instant;

    fn here() -> std::path::PathBuf {
        std::env::temp_dir()
    }

    #[tokio::test]
    async fn collects_both_streams_and_the_exit_code() {
        let result = run("echo out; echo err >&2; exit 3", &here(), 10.0).await;
        assert_eq!(result.stdout, b"out\n");
        assert_eq!(result.stderr, b"err\n");
        assert_eq!(result.exit_code, 3);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn runs_in_the_given_directory_with_stdin_closed() {
        let dir = tempfile::tempdir().unwrap();
        let real = dunce::canonicalize(dir.path()).unwrap();
        let result = run("pwd; cat", &real, 10.0).await;
        assert_eq!(
            String::from_utf8(result.stdout).unwrap().trim(),
            real.to_string_lossy()
        );
        assert_eq!(result.exit_code, 0);
    }

    #[tokio::test]
    async fn a_timeout_kills_the_whole_tree_and_keeps_the_output() {
        let started = Instant::now();
        let result = run("echo before; sleep 30 & sleep 30", &here(), 1.0).await;
        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
        assert_eq!(result.stdout, b"before\n");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "took {:?}",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn a_background_child_holding_the_pipe_is_killed_at_the_timeout() {
        let started = Instant::now();
        let result = run("sleep 30 &", &here(), 1.0).await;
        assert!(result.timed_out);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "took {:?}",
            started.elapsed()
        );
    }
}
