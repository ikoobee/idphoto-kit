import { type Spec, SpecSchema } from "@idphoto-kit/specs/browser"

/**
 * Load the spec library straight from the repo's /specs directory — the same
 * JSON files CI validates (single source of truth). Parsed through the zod
 * schema so the browser fails loudly on malformed data.
 */
export function loadSpecs(): Spec[] {
  const files = import.meta.glob("../../../specs/*.json", { eager: true, import: "default" })
  const specs: Spec[] = []
  for (const [path, raw] of Object.entries(files)) {
    if (path.endsWith("schema.json")) continue
    const parsed = Array.isArray(raw) ? raw : [raw]
    for (const entry of parsed) {
      const result = SpecSchema.safeParse(entry)
      if (result.success) specs.push(result.data)
      else console.error(`invalid spec in ${path}:`, result.error.issues[0]?.message)
    }
  }
  return specs.sort((a, b) => a.slug.localeCompare(b.slug))
}
