"""Run a command on the host machine."""
from __future__ import annotations

import subprocess
import time

import config
from .common import (
    Refused,
    check_allowlist,
    clamp_timeout,
    decode,
    resolve_path,
    truncate,
)

TOOL = {
    "name": "run_command",
    "description": (
        "Run a command on the host machine and return its exit code, stdout, stderr, and "
        "duration. Use this when work has to happen on the host - running scripts, "
        "invoking a build or test runner, or inspecting host state the sandbox "
        "cannot see. Any directory on the machine may be used. A command that outruns "
        "`timeout` has its whole process tree killed, and the server carries on serving."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "Working directory. Required - there is no default. Absolute, or "
                    "relative to the server's own working directory. A path that does not "
                    "exist is refused."
                ),
            },
            "cmd": {
                "type": "string",
                "description": (
                    "The command line, run through the host shell (cmd.exe). Quote paths "
                    "containing spaces. Example: 'python main.py --dry-run'."
                ),
            },
            "timeout": {
                "type": "number",
                "description": (
                    f"Seconds to wait. Default {config.DEFAULT_TIMEOUT:.0f}, ceiling "
                    f"{config.MAX_TIMEOUT:.0f}. A command that exceeds it is killed and "
                    "reported as a timeout - the server stays up and keeps serving."
                ),
            },
        },
        "required": ["cmd", "path"],
    },
    "outputSchema": {
        "type": "object",
        "properties": {
            "exit_code": {"type": "integer"},
            "stdout": {"type": "string"},
            "stderr": {"type": "string"},
            "duration_ms": {"type": "integer"},
            "truncated": {"type": "boolean"},
            "timed_out": {"type": "boolean"},
            "cwd": {"type": "string"},
        },
        "required": ["exit_code", "stdout", "stderr", "timed_out", "cwd"],
    },
    "annotations": {
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": False,
        "openWorldHint": True,
    },
}

def _kill_tree(pid: int) -> None:
    """Kill a command and everything it spawned.
    Necessary on Windows because `shell=True` means cmd.exe starts the real work as a child.
    Killing only the shell leaves that grandchild running, still holding the stdout pipe -
    so the read below would block until the orphan finishes anyway, and a "2 second" timeout
    could come back twenty seconds later with the server wedged in the meantime.
    """
    # taskkill's own timeout is short and its failure is not interesting: the fallback kill
    # below is what actually guarantees the call returns.
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            capture_output=True, timeout=5, shell=False,
        )
    except (subprocess.SubprocessError, OSError):
        pass

def _run(command: str, cwd: str, timeout: float) -> tuple[bytes, bytes, int, bool]:
    """Run `command`, returning (stdout, stderr, exit_code, timed_out)."""
    # CREATE_NEW_PROCESS_GROUP gives the child its own process group, which is what makes
    # the tree kill above able to reach the whole thing.
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creationflags,
    )
    try:
        stdout_raw, stderr_raw = process.communicate(timeout=timeout)
        return stdout_raw or b"", stderr_raw or b"", process.returncode, False
    except subprocess.TimeoutExpired:
        # Report the timeout rather than failing silently: a caller that waited 30 seconds
        # deserves to know the command was killed and not merely that nothing came back.
        _kill_tree(process.pid)
        try:
            # Drain whatever the command managed to print before it died, so a timeout does
            # not also throw away the build output that explains why it hung.
            stdout_raw, stderr_raw = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout_raw, stderr_raw = process.communicate()
        return stdout_raw or b"", stderr_raw or b"", -1, True

def handle(args: dict) -> tuple[dict, bool]:
    cwd = resolve_path(args.get("path"))
    command = args.get("cmd")
    
    if not isinstance(command, str) or not command.strip():
        raise Refused(
            "`cmd` is required and must be a non-empty string, for example "
            "'python main.py --dry-run'."
        )
        
    check_allowlist(command)
    timeout = clamp_timeout(args.get("timeout"))
    
    started = time.monotonic()
    stdout_raw, stderr_raw, exit_code, timed_out = _run(command, str(cwd), timeout)
    duration_ms = int((time.monotonic() - started) * 1000)
    
    stdout, cut_out = truncate(decode(stdout_raw))
    stderr, cut_err = truncate(decode(stderr_raw))
    
    structured = {
        "exit_code": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "duration_ms": duration_ms,
        "truncated": cut_out or cut_err,
        "timed_out": timed_out,
        "cwd": str(cwd),
    }
    
    if timed_out:
        summary = (
            f"Timed out after {timeout:.0f}s and was killed (exit {exit_code}). "
            "The server is unaffected."
        )
    elif exit_code == 0:
        summary = f"Exited 0 in {duration_ms}ms."
    else:
        summary = f"Exited {exit_code} in {duration_ms}ms."
        
    return {"summary": summary, **structured}, exit_code == 0 and not timed_out
