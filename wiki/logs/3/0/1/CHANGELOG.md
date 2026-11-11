# 3.0.1

**Released:** 2026-11-11

**Internal.** `src/` is split by role, one job per file, in the same folders as `lxagents-github`
and `lxagents-gitlab`. Nothing a client sees changes: the same three tools, `run_command`,
`read_file` and `list_directory`, with the same arguments, flags, limits, results and refusal
messages. `node src/index.js` is still the entry point.

**Clients must:** nothing. A client that points at `src/index.js` keeps working as it is.

## Modified

| Before | After |
|---|---|
| `src/server.js` | `src/routes/server.js`; the result text moved to `src/utils/render.js` |
| `src/tools/` | `src/controllers/`; `run-command.js` hands spawning and tree killing to `src/services/process.js` |
| `src/tools/common.js` | `src/services/paths.js`, `src/services/allowlist.js`, `src/models/args.js`, `src/utils/errors.js`, `src/utils/text.js` |
| `src/config.js`, `src/options.js`, `src/version.js` | `src/config/`; the flags are applied in `src/index.js` |
| `src/log.js` | `src/utils/log.js` |

A folder imports only from the folders below it: routes, controllers, services, models, utils, config.
The README's Development section has the map.

## Verified

`npm test`: 57 passing, none failing, the same as before. `node src/index.js --help` prints the same
usage.
