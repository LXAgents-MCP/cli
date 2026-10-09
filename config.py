"""Every knob this server has, in one place. Read these as `config.NAME`, never as `from config import NAME`. `main()` overwrites some of them from the command line, and a by-name import would bind the value at import time and silently ignore --confine and --timeout. Attribute access is late-bound, so the handlers see the values actually in force."""
from __future__ import annotations
from pathlib import Path

# Optional confinement boundary, as an absolute resolved Path. None means nothing is
# confined, which is the default: `cmd` is a free-form shell string, so bounding `path`
# would limit where a command *starts* while leaving where it *goes* wide open. A boundary
# that reads as a guarantee it cannot keep is worse than no boundary at all.
# There is deliberately no default value here and no fallback directory - the server has no
# opinion about where your code lives. Pass --confine <dir> to impose one.
CONFINE_ROOT: Path | None = None

# Off means every executable may run; populate to narrow it.
ALLOWED_EXECUTABLES = ()
DEFAULT_TIMEOUT = 30.0          # seconds; long enough for a build step
MAX_TIMEOUT = 600.0             # the ceiling a model cannot argue its way past
MAX_OUTPUT = 30000              # chars; past this the model reasons about a partial result
                                # as though it were complete
MAX_LIST_ENTRIES = 500          # a listing is for orientation, not for transfer
MAX_FILE_BYTES = 200_000        # and a file is read to be looked at, not ingested
PROTOCOL_VERSION = "2025-06-18"
KNOWN_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
SERVER_NAME = "host-cli"
SERVER_VERSION = "1.2.0"

def confine_root() -> Path | None:
    """The confinement boundary, or None when the server is unconfined."""
    return CONFINE_ROOT
