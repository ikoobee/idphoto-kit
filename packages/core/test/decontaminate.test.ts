import { describe, expect, it } from "vitest"
import { decontaminateEdges, estimateBackgroundColor } from "../src/decontaminate.ts"
import { makeImage } from "../src/types.ts"

function make(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number, number],
) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y)
      const p = (y * w + x) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = a
    }
  }
  return makeImage(w, h, data)
}

describe("estimateBackgroundColor", () => {
  it("averages clearly-background pixels and skips the subject", () => {
    // left half background red, right half subject, alpha splits at x=4
    const img = make(8, 4, (x) => (x < 4 ? [200, 30, 30, 255] : [30, 30, 200, 255]))
    const alpha = new Uint8ClampedArray(8 * 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) alpha[y * 8 + x] = x < 4 ? 0 : 255
    const bg = estimateBackgroundColor(img, alpha)
    expect(bg).toEqual([200, 30, 30])
  })

  it("returns null when every pixel is subject", () => {
    const img = make(4, 4, () => [10, 20, 30, 255])
    const alpha = new Uint8ClampedArray(16).fill(255)
    expect(estimateBackgroundColor(img, alpha)).toBeNull()
  })
})

describe("decontaminateEdges", () => {
  it("un-mixes a known blend back to the subject color", () => {
    const bg: [number, number, number] = [240, 240, 240]
    const subject = [90, 40, 30]
    // edge pixel: 50% subject + 50% background
    const mixed = subject.map((c, k) => c * 0.5 + bg[k] * 0.5)
    const img = make(1, 1, () => [mixed[0]!, mixed[1]!, mixed[2]!, 255])
    const alpha = new Uint8ClampedArray([128]) // ~0.5
    const out = decontaminateEdges(img, alpha, bg)
    expect(out.data[0]).toBeCloseTo(subject[0]!, -1)
    expect(out.data[1]).toBeCloseTo(subject[1]!, -1)
    expect(out.data[2]).toBeCloseTo(subject[2]!, -1)
  })

  it("leaves solid subject and background pixels untouched", () => {
    const img = make(2, 1, (x) => (x === 0 ? [10, 10, 10, 255] : [250, 250, 250, 255]))
    const alpha = new Uint8ClampedArray([255, 0])
    const out = decontaminateEdges(img, alpha, [240, 240, 240])
    expect([...out.data.slice(0, 3)]).toEqual([10, 10, 10])
    expect([...out.data.slice(4, 7)]).toEqual([250, 250, 250])
  })

  it("never mutates the input image", () => {
    const img = make(1, 1, () => [165, 165, 165, 255])
    const before = [...img.data]
    decontaminateEdges(img, new Uint8ClampedArray([128]), [240, 240, 240])
    expect([...img.data]).toEqual(before)
  })
})

describe("decontaminateEdges correction bound", () => {
  it("never moves a pixel further than the possible background contribution", () => {
    const img = make(1, 1, () => [200, 200, 200, 255])
    const alpha = new Uint8ClampedArray([26]) // α≈0.1 — un-mixing wants −295
    const out = decontaminateEdges(img, alpha, [255, 255, 255])
    const maxShift = 0.9 * 255 + 30
    expect(out.data[0]).toBeGreaterThanOrEqual(200 - maxShift)
    expect(out.data[0]).toBeLessThanOrEqual(200 + maxShift)
  })
})
