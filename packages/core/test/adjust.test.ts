import { describe, expect, it } from "vitest"
import { adjustColors } from "../src/adjust.ts"
import { makeImage } from "../src/types.ts"

describe("adjustColors", () => {
  it("returns the input unchanged at identity", () => {
    const img = makeImage(1, 1, Uint8ClampedArray.from([10, 128, 250, 255]))
    expect(adjustColors(img)).toBe(img)
    expect(adjustColors(img, { brightness: 1, contrast: 1 })).toBe(img)
  })

  it("flattens to mid-gray at zero contrast", () => {
    const img = makeImage(1, 1, Uint8ClampedArray.from([10, 128, 250, 128]))
    const out = adjustColors(img, { contrast: 0 })
    expect([...out.data.slice(0, 3)]).toEqual([128, 128, 128])
    expect(out.data[3]).toBe(128) // alpha untouched
  })

  it("brightens around the mid-gray pivot and clamps without wraparound", () => {
    // k = contrast × brightness scales the distance from 128, not an additive lift
    const img = makeImage(1, 1, Uint8ClampedArray.from([100, 100, 100, 255]))
    expect(adjustColors(img, { brightness: 2 }).data[0]).toBe(72) // (100-128)*2+128
    expect(adjustColors(img, { brightness: 0.5 }).data[0]).toBe(114) // (100-128)*0.5+128
    const hot = makeImage(1, 1, Uint8ClampedArray.from([200, 200, 200, 255]))
    expect(adjustColors(hot, { brightness: 4 }).data[0]).toBe(255) // (200-128)*4+128 = 416 → clamp
  })
})
