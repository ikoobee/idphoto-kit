import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { RawSpecEntry } from "./schema.ts"

/** Repo-root /specs directory. In-repo development path; npm publishing (M2) will inline the data at build time. */
export function specsDir(): string {
  // packages/specs-ts/src/loader.ts -> ../../../specs
  const here = fileURLToPath(new URL(".", import.meta.url))
  return join(here, "..", "..", "..", "specs")
}

/** All spec JSON files (everything except schema.json), sorted for deterministic order. */
export function listSpecFiles(dir = specsDir()): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
    .sort()
}

/**
 * Load every spec entry from /specs. Each file must contain a JSON array.
 * No schema validation here — pair with check.ts.
 */
export function loadRawSpecs(dir = specsDir()): RawSpecEntry[] {
  const entries: RawSpecEntry[] = []
  for (const file of listSpecFiles(dir)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), "utf8"))
    } catch (e) {
      throw new Error(`${file}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${file}: expected a JSON array of spec entries`)
    }
    for (const [index, data] of parsed.entries()) {
      entries.push({ file, index, data: data as unknown })
    }
  }
  return entries
}
