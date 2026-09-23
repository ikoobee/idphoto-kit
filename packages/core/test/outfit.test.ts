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
  it("locates head width, chin narrowing, shoulder flare, and shoulder extents", () => {
    const m = silhouetteMetrics(syntheticAlpha(), 100, 200)
    expect(m.headW).toBeCloseTo(40, 0)
    expect(m.chinY).toBe(60) // first row where width drops to 16 < 40*0.5
    expect(m.shoulderY).toBe(80) // first row where width ≥ 40*1.5 = 60
    expect(m.headH).toBe(60)
    expect(m.bbox.x0).toBe(10)
    expect(m.bbox.x1).toBe(89)
    expect(m.shoulderLX).toBe(10) // shoulder row extents, not head-width formula
    expect(m.shoulderRX).toBe(89)
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

  it.each(ids)("%s yields in-bounds shapes with valid paints", (id) => {
    const shapes = buildOutfitShapes(id, m, 200)
    expect(shapes.length).toBeGreaterThanOrEqual(3)
    for (const s of shapes) {
      expect(["M", "E"]).toContain(s.path[0]?.op) // radial layers open with an ellipse
      if (s.paint.kind === "solid")
        expect(s.paint.color).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      if (s.paint.kind === "linear") {
        expect(["v", "h"]).toContain(s.paint.dir)
        expect(s.paint.stops.length).toBeGreaterThanOrEqual(2)
      }
      if (s.paint.kind === "radial") expect(s.paint.r).toBeGreaterThan(0)
      for (const cmd of s.path) {
        if (cmd.op === "Z") continue
        if (cmd.op === "E") {
          expect(cmd.cx - cmd.rx).toBeGreaterThanOrEqual(-5)
          expect(cmd.cx + cmd.rx).toBeLessThanOrEqual(105)
          expect(cmd.cy - cmd.ry).toBeGreaterThanOrEqual(-5)
          expect(cmd.cy + cmd.ry).toBeLessThanOrEqual(200)
          continue
        }
        expect(cmd.x).toBeGreaterThanOrEqual(-5)
        expect(cmd.x).toBeLessThanOrEqual(105)
        expect(cmd.y).toBeGreaterThanOrEqual(-5)
        expect(cmd.y).toBeLessThanOrEqual(200)
      }
    }
  })

  it("anchors the garment on the real shoulder extents, not the canvas", () => {
    const shapes = buildOutfitShapes("suit", m, 200)
    const body = shapes[0]!
    const xs = body.path.flatMap((c) =>
      c.op === "M" || c.op === "L" ? [c.x] : c.op === "Q" ? [c.x] : [],
    )
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect(maxX - minX).toBeGreaterThan(m.headW) // shoulder-wide
    expect(maxX - minX).toBeLessThan(100) // not canvas-wide
    // centered on the silhouette
    expect((minX + maxX) / 2).toBeCloseTo((m.bbox.x0 + m.bbox.x1) / 2, 0)
  })

  it("includes the neck-blend and chin-shadow finishing layers", () => {
    for (const id of ids) {
      const shapes = buildOutfitShapes(id, m, 200)
      const radials = shapes.filter((s) => s.paint.kind === "radial")
      expect(radials.length).toBeGreaterThanOrEqual(2) // neck blend + chin AO
    }
  })

  it("takes the collar skin tone from style options", () => {
    const shapes = buildOutfitShapes("suit", m, 200, { skin: [255, 0, 0] })
    const blend = shapes.find(
      (s) => s.paint.kind === "radial" && s.paint.stops[0]![1].includes("255,0,0"),
    )
    expect(blend).toBeDefined()
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
    const alpha = new Uint8ClampedArray(w * h).fill(255)
    const outfit = solid([0, 0, 255, 255])
    expect(mergeOutfitLayer(person, alpha, outfit, seamY, feather).alpha[9 * w]).toBe(255)

    const empty = new Uint8ClampedArray(w * h) // no silhouette → outfit suppressed
    expect(mergeOutfitLayer(person, empty, outfit, seamY, feather).alpha[9 * w]).toBe(0)
  })

  it("throws on dimension mismatch", () => {
    const person = solid([0, 0, 0, 255])
    const alpha = new Uint8ClampedArray(w * h)
    const wrong = makeImage(w + 1, h, new Uint8ClampedArray((w + 1) * h * 4))
    expect(() => mergeOutfitLayer(person, alpha, wrong, seamY, feather)).toThrow(/dimensions/)
  })
})
