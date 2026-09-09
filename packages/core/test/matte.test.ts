import { describe, expect, it } from "vitest"
import { refineAlpha } from "../src/matte.ts"

describe("refineAlpha", () => {
  it("keeps binary masks untouched (no feather)", () => {
    const a = Uint8ClampedArray.from([0, 0, 255, 255, 0, 255])
    expect(Array.from(refineAlpha(a, 3, 2, { feather: 0 }))).toEqual([0, 0, 255, 255, 0, 255])
  })

  it("narrows the transition band around the midpoint", () => {
    // default band [0.35, 0.65]: 0.40 must drop toward 0, 0.60 rise toward 255
    const v = (f: number) => Math.round(f * 255)
    const out = refineAlpha(Uint8ClampedArray.from([v(0.4), v(0.5), v(0.6)]), 3, 1, {
      feather: 0,
    })
    const [a, mid, b] = [out[0]!, out[1]!, out[2]!]
    expect(a).toBeLessThan(64) // 0.40 → strongly background
    expect(b).toBeGreaterThan(191) // 0.60 → strongly foreground
    expect(mid).toBeGreaterThan(a)
    expect(mid).toBeLessThan(b)
  })

  it("holds the 50% point at ~50%", () => {
    const out = refineAlpha(Uint8ClampedArray.from([128]), 1, 1, { feather: 0 })
    expect(Math.abs(out[0]! - 128)).toBeLessThanOrEqual(3)
  })

  it("feathers the transition band but never touches binary pixels", () => {
    // 115/140 sit mid-band: smoothstep keeps them partial; feather then
    // averages them with neighborhoods — never flattens to binary
    const a = Uint8ClampedArray.from([0, 115, 140, 255, 0, 115, 140, 255])
    const out = refineAlpha(a, 4, 2, { feather: 1 })
    expect(out[0]!).toBe(0) // binary background untouched
    expect(out[3]!).toBe(255) // binary foreground untouched
    // band pixels survive as partial alpha (softened, not flattened)
    for (const i of [1, 2, 5, 6]) {
      expect(out[i]!).toBeGreaterThan(0)
      expect(out[i]!).toBeLessThan(255)
    }
  })

  it("wider custom band softens less aggressively", () => {
    const v = (f: number) => Math.round(f * 255)
    const narrow = refineAlpha(Uint8ClampedArray.from([v(0.42)]), 1, 1, {
      lowCut: 0.35,
      highCut: 0.65,
      feather: 0,
    })
    const wide = refineAlpha(Uint8ClampedArray.from([v(0.42)]), 1, 1, {
      lowCut: 0.2,
      highCut: 0.8,
      feather: 0,
    })
    expect(wide[0]!).toBeGreaterThan(narrow[0]!)
  })
})
