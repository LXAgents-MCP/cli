# 4.0.0

**Released:** 2026-11-11

**Breaking: the server is TypeScript, and the entry point is now `dist/index.js`.** The sources under
`src/` are strict TypeScript compiled by `tsc` into `dist/`, which `npm install` builds. The tools,
their arguments, flags, limits, results and refusal messages are unchanged: the same `run_command`,
`read_file` and `list_directory`, still over stdio only.

**Clients must:** run `npm install` once in the clone (it builds `dist/`), change the path in the
client configuration's `args` from `src/index.js` to `dist/index.js`, and restart the client. After a
later pull, run `npm install` or `npm run build` again.

## Added

- `tsconfig.json`: `ES2022`, `NodeNext`, `strict`, `rootDir` `src`, `outDir` `dist`.
- `tsconfig.test.json`: type-checks `src/` and `test/` together without emitting.
- `src/models/tool.ts`: the types every tool module shares (`ToolDefinition`, `ToolArgs`,
  `ToolPayload`, `ToolOutcome`, `ToolModule`, `ToolSpec`).
- Scripts `build` (`tsc`), `typecheck`, `prepare` (builds on `npm install`) and `pretest` (builds and
  type-checks before the suite).
- devDependencies `typescript` 7.0.2, `@types/node` 26.6.6 and `tsx` 4.23.15.

## Changed

- Every module in `src/` and `test/` is `.ts` instead of `.js`.
- `main`, `start` and `inspect` point at `dist/index.js`; `test` runs
  `node --import tsx --test test/*.test.ts`.
- The usage text reads `Usage: node dist/index.js [options]`.
- Tool discovery accepts `.ts` modules as well as `.js`, so the registry works from source under
  `tsx` and compiled in `dist/`.
- `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7.

## Security

- `npm audit` reports 0 vulnerabilities, from 5 before (2 high, 3 moderate): `zod` below 4.6.6, and
  `body-parser`, `fast-uri`, `ip-address` and `qs` through the SDK's dependency tree.

## Verified

`npm run build` and `npm run typecheck`: no error. `npm test`: 57 passing, none failing, the same as
before, with the stdio suite started against `dist/index.js`. `node dist/index.js --help` prints the
usage and exits 0.
