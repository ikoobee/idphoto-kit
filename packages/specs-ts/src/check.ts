import { type RawSpecEntry, type Spec, SpecSchema } from "./schema.ts"

export interface SpecIssue {
  entry: string
  message: string
}

/** Business rules layered on top of the zod schema. */
const MAX_CHECKED_AT_AGE_DAYS = 365

function daysSince(dateStr: string): number {
  const then = Date.parse(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return (Date.now() - then) / 86_400_000
}

/**
 * Validate all raw entries (zod schema + business rules).
 * Returns the parsed specs plus every issue found — never throws on bad data.
 */
export function checkSpecs(raw: RawSpecEntry[]): { specs: Spec[]; issues: SpecIssue[] } {
  const issues: SpecIssue[] = []
  const specs: Spec[] = []
  const seenSlugs = new Map<string, string>()

  for (const entry of raw) {
    const label = `${entry.file}[${entry.index}]`

    const result = SpecSchema.safeParse(entry.data)
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({ entry: label, message: `${issue.path.join(".")}: ${issue.message}` })
      }
      continue
    }
    const spec = result.data
    const slugLabel = `${label} (${spec.slug})`

    // Business rule: slugs must be globally unique
    const dupOf = seenSlugs.get(spec.slug)
    if (dupOf) {
      issues.push({ entry: slugLabel, message: `duplicate slug — already defined in ${dupOf}` })
    } else {
      seenSlugs.set(spec.slug, label)
    }

    // Business rule: verification must be recent (specs go stale)
    const age = daysSince(spec.source.checkedAt)
    if (age > MAX_CHECKED_AT_AGE_DAYS) {
      issues.push({
        entry: slugLabel,
        message: `source.checkedAt is ${Math.floor(age)} days old (> ${MAX_CHECKED_AT_AGE_DAYS}); re-verify`,
      })
    }

    // Business rule: a byte-size cap only makes sense for lossy JPEG
    if (spec.file.maxKB !== null && !spec.file.formats.includes("jpg")) {
      issues.push({
        entry: slugLabel,
        message: "file.maxKB set but formats does not include 'jpg'",
      })
    }

    // Business rule: head-height ratio, when present, must be a sane interval
    const ratio = spec.face.headHeightRatio
    if (ratio !== null) {
      const [lo, hi] = ratio
      if (lo >= hi || lo < 0.2 || hi > 1) {
        issues.push({
          entry: slugLabel,
          message: "face.headHeightRatio must be [min,max] with 0.2 ≤ min < max ≤ 1",
        })
      }
    }

    specs.push(spec)
  }

  return { specs, issues }
}
