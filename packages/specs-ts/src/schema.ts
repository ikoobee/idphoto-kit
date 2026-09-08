import { z } from "zod"

/**
 * Authoritative zod schema for spec entries.
 * specs/schema.json is the human-readable mirror — keep both in sync
 * (see specs/schema.json header comment).
 */

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "must be #RRGGBB")
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")

export const SpecCategory = z.enum(["std", "exam", "cert", "visa", "job", "print"])
export type SpecCategory = z.infer<typeof SpecCategory>

export const SpecSchema = z.object({
  /** Unique kebab-case ID */
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.object({ zh: z.string().min(1), en: z.string().min(1) }),
  aliases: z.array(z.string()).default([]),
  category: SpecCategory,
  /** ISO 3166 country code, or "GLOBAL" */
  region: z.string().min(2).max(8),
  size: z.object({
    width: z.number().int().min(20).max(8192),
    height: z.number().int().min(20).max(8192),
    unit: z.literal("px"),
    dpi: z.number().int().positive().nullable(),
    /** Display-only physical size, e.g. "25×35" */
    mm: z.string().nullable().default(null),
  }),
  background: z.object({
    allowed: z.array(hexColor).min(1),
    transparent: z.boolean().default(true),
  }),
  file: z.object({
    formats: z.array(z.enum(["jpg", "png"])).min(1),
    maxKB: z.number().int().positive().nullable().default(null),
  }),
  face: z
    .object({
      /** [min, max] fraction of image height, null = engine defaults */
      headHeightRatio: z.tuple([z.number(), z.number()]).nullable().default(null),
      /** Eye line position from top, null = engine defaults */
      eyeLineRatio: z.number().nullable().default(null),
    })
    .default({ headHeightRatio: null, eyeLineRatio: null }),
  source: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    /** Date of last manual verification */
    checkedAt: isoDate,
  }),
  notes: z
    .object({ zh: z.string().default(""), en: z.string().default("") })
    .default({ zh: "", en: "" }),
})

export type Spec = z.infer<typeof SpecSchema>
export type RawSpecInput = z.input<typeof SpecSchema>

/** A spec entry before zod parsing, tagged with its origin file for error reporting */
export interface RawSpecEntry {
  file: string
  index: number
  data: unknown
}
