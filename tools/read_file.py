"""Read a text file from the host."""

from __future__ import annotations

import config
from .common import Refused, decode, resolve_path

TOOL = {
    "name": "read_file",
    "description": (
        "Read a text file from the host and return its contents. Use this instead of shelling "
        "out to `type` or `cat`: it handles Windows encodings and a byte cap, and it will "
        "not mangle a file the way a console pipe does. Read-only."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "File to read. Required - there is no default. Absolute, or relative to "
                    "the server's own working directory. Must be an existing file."
                ),
            },
            "max_bytes": {
                "type": "integer",
                "description": (
                    f"Maximum bytes to read. Default and ceiling {config.MAX_FILE_BYTES}."
                ),
            },
        },
        "required": ["path"],
    },
    "outputSchema": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"},
            "bytes_read": {"type": "integer"},
            "truncated": {"type": "boolean"},
        },
        "required": ["path", "content", "bytes_read", "truncated"],
    },
    "annotations": {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
}


def handle(args: dict) -> tuple[dict, bool]:
    target = resolve_path(args.get("path"), must_be_dir=False)

    if target.is_dir():
        raise Refused(
            f"`path` {target} is a directory, not a file. Use list_directory on it instead."
        )

    limit = config.MAX_FILE_BYTES
    if args.get("max_bytes") is not None:
        try:
            limit = max(1, min(int(args["max_bytes"]), config.MAX_FILE_BYTES))
        except (TypeError, ValueError):
            raise Refused(
                f"`max_bytes` must be an integer, got {args['max_bytes']!r}."
            ) from None

    with target.open("rb") as handle_:
        raw = handle_.read(limit + 1)

    truncated = len(raw) > limit
    if truncated:
        raw = raw[:limit]

    text = decode(raw)
    if text.startswith(chr(0xFEFF)):   # a UTF-8 BOM is an encoding artefact, not content
        text = text[1:]

    return {
        "summary": f"Read {len(raw)} bytes from {target}"
        + (" (truncated)." if truncated else "."),
        "path": str(target),
        "content": text,
        "bytes_read": len(raw),
        "truncated": truncated,
    }, True