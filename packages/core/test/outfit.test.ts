import { describe, expect, it } from "vitest"
import {
  buildOutfitShapes,
  mergeOutfitLayer,
  type OutfitId,
  silhouetteMetrics,
} from "../src/outfit.ts"
import { makeImage } from "../src/types.ts"

/** Synthetic silhouette: head block → neck → shoulders, on a 100×200 grid. */
function syntheticAlpha(): Uint8ClampedArray {
  const w = 100
  const h = 200
  const a = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const half = y < 60 ? 20 : y < 80 ? 8 : 40 // head / neck / shoulders
    for (let x = 50 - half; x < 50 + half; x++) a[y * w + x] = 255
  }
  return a
}

describe("silhouetteMetrics", () => {
  it("locates head width, chin narrowing, and shoulder flare", () => {
    const m = silhouetteMetrics(syntheticAlpha(), 100, 200)
    expect(m.headW).toBeCloseTo(40, 0)
    expect(m.chinY).toBe(60) // first row where width drops to 16 < 40*0.5
    expect(m.shoulderY).toBe(80) // first row where width ≥ 40*1.5 = 60
    expect(m.headH).toBe(60)
    expect(m.bbox.x0).toBe(10)
    expect(m.bbox.x1).toBe(89)
  })

  it("degrades to a sane centered box on an empty matte", () => {
    const m = silhouetteMetrics(new Uint8ClampedArray(100 * 200), 100, 200)
    expect(m.bbox.x0).toBe(30)
    expect(m.shoulderY).toBeGreaterThan(0)
    expect(m.headH).toBeGreaterThan(0)
  })
})

describe("buildOutfitShapes", () => {
  const ids: OutfitId[] = ["suit", "career", "academic"]
  const m = silhouetteMetrics(syntheticAlpha(), 100, 200)

  it.each(ids)("%s yields only in-bounds, hex-filled polygons", (id) => {
    const shapes = buildOutfitShapes(id, m, 200)
    expect(shapes.length).toBeGreaterThan(0)
    for (const s of shapes) {
      expect(s.fill).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(s.path[0]?.op).toBe("M")
      for (const cmd of s.path) {
        if (cmd.op === "Z") continue
        expect(cmd.x).toBeGreaterThanOrEqual(-5)
        expect(cmd.x).toBeLessThanOrEqual(105)
        expect(cmd.y).toBeGreaterThanOrEqual(-5)
        expect(cmd.y).toBeLessThanOrEqual(200)
      }
    }
  })

  it("anchors the template symmetric around the silhouette center", () => {
    const shapes = buildOutfitShapes("suit", m, 200)
    const xs = shapes[0]!.path.flatMap((c) => (c.op === "Z" ? [] : [c.x]))
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect((minX + maxX) / 2).toBeCloseTo((m.bbox.x0 + m.bbox.x1) / 2, 6) // centered on the person
    expect(maxX - minX).toBeGreaterThan(m.headW) // shoulder-wide, not neck-wide
    expect(maxX - minX).toBeLessThan(100) // not canvas-wide
  })
})

describe("mergeOutfitLayer", () => {
  const w = 10
  const h = 10
  const seamY = 5
  const feather = 1

  function solid(fill: [number, number, number, number]): ReturnType<typeof makeImage> {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let p = 0; p < data.length; p += 4) {
      data[p] = fill[0]
      data[p + 1] = fill[1]
      data[p + 2] = fill[2]
      data[p + 3] = fill[3]
    }
    return makeImage(w, h, data)
  }

  it("keeps the person above the seam and the outfit below it", () => {
    const person = solid([255, 0, 0, 255])
    const alpha = new Uint8ClampedArray(w * h).fill(255)
    const outfit = solid([0, 0, 255, 255])
    const { portrait, alpha: merged } = mergeOutfitLayer(person, alpha, outfit, seamY, feather)

    const top = 2 * w * 4
    expect(portrait.data[top]).toBe(255) // red person
    expect(portrait.data[top + 2]).toBe(0)
    const bottom = 9 * w * 4
    expect(portrait.data[bottom]).toBe(0) // blue outfit
    expect(portrait.data[bottom + 2]).toBe(255)
    expect(merged[2 * w]).toBe(255)
    expect(merged[9 * w]).toBe(255)
  })

  it("clips the outfit to the person silhouette", () => {
    const person = solid([255, 0, 0, 255])
    const alpha = new Uint8ClampedArray(w * h).fill(0) // no silhouette at all
    alpha.fill(255, 0, w * h) // …then fully restored: control case below
    const outfit = solid([0, 0, 255, 255])
    const withSilhouette = mergeOutfitLayer(person, alpha, outfit, seamY, feather)
    expect(withSilhouette.alpha[9 * w]).toBe(255)

    const empty = new Uint8ClampedArray(w * h) // truly empty silhouette
    const without = mergeOutfitLayer(person, empty, outfit, seamY, feather)
    expect(without.alpha[9 * w]).toBe(0) // outfit suppressed without a person
  })

  it("throws on dimension mismatch", () => {
    const person = solid([0, 0, 0, 255])
    const alpha = new Uint8ClampedArray(w * h)
    const wrong = makeImage(w + 1, h, new Uint8ClampedArray((w + 1) * h * 4))
    expect(() => mergeOutfitLayer(person, alpha, wrong, seamY, feather)).toThrow(/dimensions/)
  })
})
