"""Shared helpers for the tool modules. Nothing here writes to stdout. stdout is the protocol channel and belongs to server.py - one stray print() corrupts the stream, and the client then blames the payload it failed to parse rather than the logging that broke it."""
from __future__ import annotations

import shlex
import sys
from pathlib import Path

import config

class Refused(Exception):
    """A request the owner would not want served. Carries a message worth reading."""
    pass

def resolve_path(raw: str | None, must_be_dir: bool = True) -> Path:
    """Resolve the required `path` argument into a usable absolute path.
    `path` is required on every tool. There is no default directory: the server has no
    opinion about where your code lives, and guessing one is how a tool ends up writing
    somewhere you did not ask for. A relative path is resolved against the server process's
    own working directory, which is where the client started it.
    When the server was started with --confine <dir>, `resolve()` is what makes the check
    real: it collapses `..` and follows symlinks, so neither traversal nor a link out of the
    tree gets past it.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise Refused(
            "`path` is required and must be a non-empty string. "
            "There is no default; pass one explicitly."
        )
    if not isinstance(raw, str):
        raise Refused(f"`path` must be a string, got {type(raw).__name__}.")
        
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    resolved = candidate.resolve()
    
    root = config.confine_root()
    if root is not None and not resolved.is_relative_to(root):
        raise Refused(
            f"`path` resolved to {resolved}, which is outside the allowed root {root}. "
            "Pass a path inside the root, or restart the server without --confine."
        )
        
    if must_be_dir:
        if not resolved.exists():
            raise Refused(f"`path` {resolved} does not exist.")
        if not resolved.is_dir():
            raise Refused(f"`path` {resolved} is a file, not a directory.")
            
    return resolved

def first_token(command: str) -> str:
    """The executable in a command line, for the allowlist check.
    Best effort by nature - a shell line can build its executable any number of ways - which
    is why the allowlist is a narrowing measure and not a boundary.
    """
    try:
        parts = shlex.split(command, posix=False)
    except ValueError:
        parts = command.split()
    return Path(parts[0]).stem.lower() if parts else ""

def check_allowlist(command: str) -> None:
    if not config.ALLOWED_EXECUTABLES:
        return
    token = first_token(command)
    if token not in config.ALLOWED_EXECUTABLES:
        allowed = ", ".join(sorted(config.ALLOWED_EXECUTABLES))
        raise Refused(
            f"`cmd` starts with {token!r}, which is not in the allowlist. Allowed: {allowed}."
        )

def clamp_timeout(value) -> float:
    try:
        requested = float(value)
    except (TypeError, ValueError):
        return float(config.DEFAULT_TIMEOUT)
    return max(1.0, min(requested, config.MAX_TIMEOUT))

def decode(payload: bytes) -> str:
    """Decode a byte string using utf-8, falling back to cp1252 if necessary."""
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("cp1252", errors="replace")

def truncate(text: str) -> tuple[str, bool]:
    if len(text) > config.MAX_OUTPUT:
        return text[:config.MAX_OUTPUT] + "\n... (truncated)", True
    return text, False
