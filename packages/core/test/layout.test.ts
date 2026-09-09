import { describe, expect, it } from "vitest"
import { layoutPrintSheet } from "../src/layout.ts"
import { makeImage, type RgbaImage } from "../src/types.ts"

/** Portrait with a red center marker on white. */
function markedPortrait(w: number, h: number): RgbaImage {
  const px = new Array(w * h * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 255))
  const cx = Math.floor(w / 2)
  const cy = Math.floor(h / 2)
  const i = (cy * w + cx) * 4
  px[i] = 255
  px[i + 1] = 0
  px[i + 2] = 0
  return makeImage(w, h, px)
}

/** Column indices containing a red pixel. */
function redColumns(img: RgbaImage): Set<number> {
  const cols = new Set<number>()
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (img.data[i]! === 255 && img.data[i + 1]! === 0 && img.data[i + 2]! === 0) cols.add(x)
    }
  return cols
}

describe("layoutPrintSheet", () => {
  it("tiles a 1-inch portrait at the classic 4×2 on a 6-inch sheet", () => {
    const r = layoutPrintSheet(markedPortrait(295, 413))
    expect(r.sheet.width).toBe(1800)
    expect(r.sheet.height).toBe(1200)
    expect(r.cols).toBe(4)
    expect(r.rows).toBe(2)
    expect(r.count).toBe(8)
  })

  it("marks appear in 4 distinct column clusters (8 tiles)", () => {
    const r = layoutPrintSheet(markedPortrait(295, 413))
    const cols = [...redColumns(r.sheet)].sort((a, b) => a - b)
    // cluster consecutive column indices
    let clusters = 1
    for (let i = 1; i < cols.length; i++) if (cols[i]! - cols[i - 1]! > 4) clusters++
    expect(clusters).toBe(4)
  })

  it("spreads tiles with balanced gutters (≈124px for 1-inch)", () => {
    const r = layoutPrintSheet(markedPortrait(295, 413))
    const cols = [...redColumns(r.sheet)].sort((a, b) => a - b)
    const centers: number[] = []
    let start = cols[0]!
    let prev = cols[0]!
    for (let i = 1; i <= cols.length; i++) {
      const cur = cols[i] ?? Number.MAX_SAFE_INTEGER
      if (cur - prev > 4) {
        centers.push((start + prev) / 2)
        start = cur
      }
      prev = cur
    }
    const gap = centers[1]! - centers[0]! // tile pitch = 295 + gutter
    expect(gap).toBeGreaterThan(400) // 295 + ~124 gutter
    expect(gap).toBeLessThan(430)
  })

  it("fits a 2-inch portrait at 2×2 on a small custom sheet", () => {
    const r = layoutPrintSheet(markedPortrait(413, 579), { paperWidth: 1000, paperHeight: 1300 })
    expect(r.sheet.width).toBe(1000)
    expect(r.count).toBeGreaterThanOrEqual(4)
  })

  it("rejects a portrait larger than the sheet", () => {
    // 1790 > 1800 − 2×10 margin → genuinely oversized
    expect(() => layoutPrintSheet(markedPortrait(1790, 1190))).toThrow(/fit/)
  })

  it("paper is white and fully opaque away from tiles", () => {
    const r = layoutPrintSheet(markedPortrait(295, 413))
    const i = (5 * r.sheet.width + 5) * 4 // top-left corner, inside minGap margin
    expect([...r.sheet.data.slice(i, i + 4)]).toEqual([255, 255, 255, 255])
  })
})
