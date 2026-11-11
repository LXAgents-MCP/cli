/**
 * Tool registry: one module per tool, discovered rather than listed.
 *
 * Adding a tool is a new file in this directory that exports `TOOL` (name, description and
 * schemas) and `handle(args)`, resolving to `{ payload, ok }` - the types are in
 * `src/models/tool.ts`. Nothing needs editing elsewhere - `src/routes/server.ts` never names a
 * tool, so the protocol layer cannot grow a per-tool special case. A module that does not export
 * both is skipped, so a helper dropped here is never callable as a tool - but helpers belong in
 * `src/services/` or `src/utils/`, not here.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolModule, ToolSpec } from "../models/tool.js";

export type { ToolSpec } from "../models/tool.js";

const HERE: string = dirname(fileURLToPath(import.meta.url));

/**
 * Whether `file` is a module that may hold a tool. Compiled, the tools are `.js` in `dist/`; run
 * from source under `tsx`, they are `.ts` in `src/`. A declaration file is never a module.
 */
function isToolFile(file: string): boolean {
  if (file.endsWith(".d.ts")) return false;
  return (file.endsWith(".js") || file.endsWith(".ts")) && !/^index\.[jt]s$/.test(file);
}

/**
 * Import every tool module in `dir`.
 *
 * @param dir Defaults to this directory; a different one is for tests.
 */
export async function discoverTools(dir: string = HERE): Promise<Map<string, ToolSpec>> {
  const found = new Map<string, ToolSpec>();
  const files = readdirSync(dir).filter(isToolFile).sort();

  for (const file of files) {
    const { TOOL, handle } = (await import(pathToFileURL(join(dir, file)).href)) as Partial<ToolModule>;
    if (TOOL === undefined || typeof handle !== "function") continue;

    if (!TOOL.name) throw new Error(`${file} TOOL has no 'name'.`);
    if (found.has(TOOL.name)) {
      // Two tools answering to one name makes tools/call dispatch arbitrary; fail loudly at
      // startup rather than silently at call time.
      throw new Error(`Duplicate tool name '${TOOL.name}' in ${file}.`);
    }
    found.set(TOOL.name, { name: TOOL.name, TOOL, handle });
  }

  return found;
}

export const REGISTRY: Map<string, ToolSpec> = await discoverTools();

export const TOOLS: ToolSpec[] = [...REGISTRY.values()];

export function get(name: string): ToolSpec | undefined {
  return REGISTRY.get(name);
}
