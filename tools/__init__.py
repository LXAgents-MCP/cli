"""Tool registry: one module per tool, discovered rather than listed.

Adding a tool is a new file in this package that exposes `TOOL` (the JSON schema)
and `handle(args) -> (payload, ok)`. Nothing needs editing elsewhere - server.py
never names a tool, so the protocol layer cannot grow a per-tool special case.

A module that does not export both is skipped: `common.py` lives here too, and
helpers have no business being callable as a tool.
"""
from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass
from typing import Any, Callable

# (payload, ok) -> payload is the structured result; ok decides the `isError` flag.
Handler = Callable[[dict], "tuple[dict, bool]"]

@dataclass(frozen=True)
class ToolSpec:
    name: str
    schema: dict
    handler: Handler

def _discover() -> dict[str, ToolSpec]:
    found: dict[str, ToolSpec] = {}
    for info in pkgutil.iter_modules(__path__):
        module = importlib.import_module(f"{__name__}.{info.name}")
        schema = getattr(module, "TOOL", None)
        handler = getattr(module, "handle", None)

        if schema is None or not callable(handler):
            continue

        name = schema.get("name")
        if not name:
            raise RuntimeError(f"{info.name}.TOOL has no 'name'.")
        if name in found:
            # Two tools answering to one name makes tools/call dispatch arbitrary; fail
            # loudly at startup rather than silently at call time.
            raise RuntimeError(f"Duplicate tool name {name!r} in {info.name}.")

        found[name] = ToolSpec(name, schema, handler)
    return found

REGISTRY: dict[str, ToolSpec] = _discover()
TOOLS: list[dict[str, Any]] = [spec.schema for spec in REGISTRY.values()]

def get(name: str) -> ToolSpec | None:
    return REGISTRY.get(name)

def names() -> str:
    return ", ".join(REGISTRY)
