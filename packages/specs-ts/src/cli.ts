import { checkSpecs } from "./check.ts"
import { listSpecFiles, loadRawSpecs, specsDir } from "./loader.ts"
import type { RawSpecEntry } from "./schema.ts"

/** CI entry: validate /specs — exit 0 iff every entry passes schema + business rules. */
function main(): number {
  const dir = specsDir()
  const files = listSpecFiles(dir)
  if (files.length === 0) {
    console.error(`specs: no data files found in ${dir}`)
    return 1
  }

  let raw: RawSpecEntry[]
  try {
    raw = loadRawSpecs(dir)
  } catch (e) {
    console.error(`specs: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  const { specs, issues } = checkSpecs(raw)

  const byCategory = new Map<string, number>()
  for (const s of specs) byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1)

  console.log(`specs: ${specs.length} valid entries across ${files.length} files`)
  for (const [cat, n] of [...byCategory.entries()].sort()) console.log(`  ${cat}: ${n}`)

  if (issues.length > 0) {
    console.error(`\n${issues.length} issue(s):`)
    for (const i of issues) console.error(`  ✗ ${i.entry}: ${i.message}`)
    return 1
  }
  console.log("specs: all checks passed")
  return 0
}

process.exit(main())
