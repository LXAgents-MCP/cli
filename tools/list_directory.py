"""List what is in a directory on the host."""

from __future__ import annotations

import config
from .common import resolve_path

TOOL = {
    "name": "list_directory",
    "description": (
        "List what is in a directory on the host, with a type marker per entry. Use this to "
        "find out what exists before deciding what to run - it is cheaper than a command, "
        "and it does not execute anything. Read-only."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "Directory to list. Required - there is no default. Absolute, or "
                    "relative to the server's own working directory."
                ),
            },
            "include_hidden": {
                "type": "boolean",
                "description": "Include dot-prefixed and hidden entries. Default false.",
            },
        },
        "required": ["path"],
    },
    "outputSchema": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "type": {"type": "string"},
                        "size": {"type": "integer"},
                    },
                },
            },
            "truncated": {"type": "boolean"},
        },
        "required": ["path", "entries", "truncated"],
    },
    "annotations": {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
}


def handle(args: dict) -> tuple[dict, bool]:
    target = resolve_path(args.get("path"))
    include_hidden = bool(args.get("include_hidden", False))

    entries = []
    for child in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        if not include_hidden and child.name.startswith("."):
            continue
        try:
            stat = child.stat()
            size = stat.st_size
            kind = "dir" if child.is_dir() else "file"
        except OSError:
            # A dangling link or a permission wall is an entry, not a failure.
            size, kind = 0, "unreadable"
        entries.append({"name": child.name, "type": kind, "size": size})
        if len(entries) >= config.MAX_LIST_ENTRIES:
            break

    truncated = len(entries) >= config.MAX_LIST_ENTRIES
    return {
        "summary": f"{len(entries)} entries in {target}"
        + (" (listing capped)." if truncated else "."),
        "path": str(target),
        "entries": entries,
        "truncated": truncated,
    }, True