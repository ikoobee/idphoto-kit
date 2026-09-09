/**
 * Browser-safe entry: schema, types, and pure checks only — no node:fs loader.
 * Bundlers should use this path from web contexts.
 */

export type { SpecIssue } from "./check.ts"
export { checkSpecs } from "./check.ts"
export type {
  RawSpecEntry,
  RawSpecInput,
  Spec,
  SpecCategory as SpecCategoryType,
} from "./schema.ts"
export { SpecCategory, SpecSchema } from "./schema.ts"
