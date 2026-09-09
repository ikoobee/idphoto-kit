import { describe, expect, it } from "vitest"
import { checkSpecs } from "../src/check.ts"
import { loadRawSpecs, specsDir } from "../src/loader.ts"
import { SpecSchema } from "../src/schema.ts"

describe("specs library", () => {
  const raw = loadRawSpecs()

  it("loads the T1.3 batch of specs", () => {
    expect(raw.length).toBeGreaterThanOrEqual(16)
  })

  it("every entry passes zod schema and business rules", () => {
    const { issues } = checkSpecs(raw)
    expect(issues).toEqual([])
  })

  it("contains the CET spec with its byte-size cap", () => {
    const { specs } = checkSpecs(raw)
    const cet = specs.find((s) => s.slug === "cet")
    expect(cet).toBeDefined()
    expect(cet?.size.width).toBe(144)
    expect(cet?.size.height).toBe(192)
    expect(cet?.file.maxKB).toBe(30)
    expect(cet?.file.formats).toEqual(["jpg"])
  })

  it("US visa spec carries head-height ratio bounds", () => {
    const { specs } = checkSpecs(raw)
    const us = specs.find((s) => s.slug === "visa-us")
    expect(us?.face.headHeightRatio).toEqual([0.5, 0.69])
  })
})

describe("schema rejection cases", () => {
  const validBase = {
    slug: "test-spec",
    name: { zh: "测试", en: "Test" },
    category: "std",
    region: "CN",
    size: { width: 295, height: 413, unit: "px", dpi: 300, mm: "25×35" },
    background: { allowed: ["#FFFFFF"] },
    file: { formats: ["jpg"] },
    source: {
      name: "s",
      url: "https://example.com",
      checkedAt: new Date().toISOString().slice(0, 10),
    },
  }

  it("rejects a malformed hex color", () => {
    expect(SpecSchema.safeParse({ ...validBase, background: { allowed: ["FFF"] } }).success).toBe(
      false,
    )
  })

  it("rejects a missing source", () => {
    const rest: Record<string, unknown> = { ...validBase }
    delete rest.source
    expect(SpecSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects checkedAt that is not a plain date", () => {
    expect(
      SpecSchema.safeParse({
        ...validBase,
        source: { ...validBase.source, checkedAt: "2026-09-07T00:00:00Z" },
      }).success,
    ).toBe(false)
  })

  it("flags stale checkedAt as a business-rule issue", () => {
    const stale = [
      {
        file: "stale.json",
        index: 0,
        data: {
          ...validBase,
          slug: "stale-spec",
          source: { ...validBase.source, checkedAt: "2020-01-01" },
        },
      },
    ]
    const { issues } = checkSpecs(stale)
    expect(issues.some((i) => i.message.includes("re-verify"))).toBe(true)
  })

  it("flags maxKB without jpg format", () => {
    const weird = [
      {
        file: "weird.json",
        index: 0,
        data: { ...validBase, file: { formats: ["png"], maxKB: 30 } },
      },
    ]
    const { issues } = checkSpecs(weird)
    expect(issues.some((i) => i.message.includes("maxKB"))).toBe(true)
  })

  it("flags duplicate slugs", () => {
    const first = loadRawSpecs()[0]
    if (!first) throw new Error("no seed data loaded")
    const { issues } = checkSpecs([first, first])
    expect(issues.some((i) => i.message.includes("duplicate slug"))).toBe(true)
  })
})

describe("specsDir resolution", () => {
  it("points at the repo /specs directory", () => {
    expect(specsDir().replace(/\\/g, "/")).toMatch(/\/specs$/)
  })
})
