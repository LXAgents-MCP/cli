---
name: memory-tasks-typescript
description: Migrating the cli server from JavaScript to strict TypeScript compiled to dist/, with dependencies at their latest and a clean npm audit; released as 4.0.0.
---

# TypeScript migration — cli

## 2026-11-11 — in progress

**Goal.** The owner asked for every Node.js repository to move to TypeScript, so the code is
type-checked under `strict` and the four servers share one toolchain. `cli` is a Node.js ESM
repository (`"type": "module"`, Node 20+, the MCP SDK and `zod`), so it is in scope.

**Objective.**

* `typescript`, `@types/node` and `tsx` are devDependencies at their latest, and the runtime
  dependencies are at their latest. `npm audit` reports 0 vulnerabilities.
* `tsconfig.json` targets `ES2022` with `module` and `moduleResolution` `NodeNext`, `strict`,
  `rootDir` `./src` and `outDir` `./dist`.
* Every `.js` file in `src/` and `test/` is `.ts`, with explicit types on functions, values and
  the SDK objects, and no implicit `any`.
* `package.json`: `main` is `dist/index.js`; `build` is `tsc`; `start` runs `node dist/index.js`;
  `test` runs `node --import tsx --test test/*.test.ts`.
* `npm run build` compiles with no error, and `npm test` passes the same 57 tests, including the
  stdio suite run against the compiled server.

**Detail.** A change of language, not of behaviour: no tool, argument, description, flag, limit or
message changes, except the usage line, which names the new entry `dist/index.js`. The server stays
stdio only; it has no HTTP transport, so the request's HTTP check does not apply here. The owner is
away and asked for the recommended option wherever a question comes up; the choices are below.
Baseline before the work: 57 passing, 5 audit findings (2 high, 3 moderate).

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/typescript` | |
| 2 | Convert to TypeScript | `refactor/typescript` | |
| 3 | Corrected documentation | `docs/typescript` | |
| 4 | Release | `release/4.0.0` | |

Branches stacked: task 1 from `master`, task `k` from task `k-1`. No chain in another repository
depends on this one.

## Decisions

| # | Decision |
|---|---|
| D1 | The compiled output goes to `dist/`, which is ignored by git. A `prepare` script runs the build on `npm install`, so installing from a clone still takes one command. |
| D2 | Tests run from source through `tsx`, except the stdio suite, which starts the compiled `dist/index.js` as a client does. `pretest` builds first so it never tests a stale `dist/`. |
| D3 | Tool discovery accepts `.js` and `.ts` modules (never `.d.ts`), so the registry finds the tools both in `dist/` and when the sources run under `tsx`. |
| D4 | A second config, `tsconfig.test.json`, type-checks `test/` under the same strict settings without emitting; `npm run typecheck` runs it and `pretest` calls it. |
| D5 | The release is `4.0.0`, a major: the entry point moves from `src/index.js` to `dist/index.js`, so every client configuration has to change. No tag, nothing published. |

## Task entries

### Task 1 — plan/typescript

Landed: this record and its row in `memory-index.md`. Nothing outside `.agents/` changes. The `PR`
column is filled by the release task.
