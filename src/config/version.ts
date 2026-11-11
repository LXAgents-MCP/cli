import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The fields of `package.json` this server reads. */
interface PackageManifest {
  version: string;
}

const here: string = dirname(fileURLToPath(import.meta.url));

/** The repository root, resolved from this file rather than from cwd. */
export const ROOT: string = join(here, "..", "..");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageManifest;

export const VERSION: string = pkg.version;
export const SERVER_NAME: string = "host-cli";
