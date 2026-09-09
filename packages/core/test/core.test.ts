import { describe, expect, it } from "vitest"
import { readJpegOrientation } from "../src/exif.ts"
import { crop, resizeBilinear } from "../src/geometry.ts"
import { applyOrientation, flipH, flipV, rotate90, rotate180, transpose } from "../src/orient.ts"
import { makeImage } from "../src/types.ts"
import { gradientImage, jpegWithOrientation, pixel, solidImage } from "./helpers.ts"

describe("exif", () => {
  it("reads orientation 1–8 from a synthetic JPEG", () => {
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(readJpegOrientation(jpegWithOrientation(o))).toBe(o)
    }
  })
  it("returns null for non-JPEG bytes", () => {
    expect(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull() // PNG magic
  })
  it("returns null for a JPEG without an APP1 Exif segment", () => {
    expect(readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })
})

describe("orient", () => {
  const g = gradientImage(3, 2) // asymmetric: 3 wide, 2 tall

  it("orientation 1 or null is identity", () => {
    expect(applyOrientation(g, 1)).toBe(g)
    expect(applyOrientation(g, null)).toBe(g)
  })

  it("flipH mirrors columns", () => {
    const f = flipH(g)
    expect(f.width).toBe(3)
    expect(pixel(f, 0, 0)).toEqual(pixel(g, 2, 0))
    expect(pixel(f, 2, 1)).toEqual(pixel(g, 0, 1))
  })

  it("flipV mirrors rows", () => {
    const f = flipV(g)
    expect(pixel(f, 1, 0)).toEqual(pixel(g, 1, 1))
  })

  it("rotate180 equals flipH∘flipV", () => {
    const r = rotate180(g)
    expect(pixel(r, 0, 0)).toEqual(pixel(flipH(flipV(g)), 0, 0))
    expect(pixel(r, 2, 1)).toEqual(pixel(g, 0, 0))
  })

  it("rotate90cw swaps dimensions and maps corners", () => {
    const cw = rotate90(g, "cw")
    expect(cw.width).toBe(2)
    expect(cw.height).toBe(3)
    expect(pixel(cw, 1, 0)).toEqual(pixel(g, 0, 0)) // top-right of output = top-left of input
  })

  it("rotate90cw then ccw round-trips", () => {
    const back = rotate90(rotate90(g, "cw"), "ccw")
    expect(Array.from(back.data)).toEqual(Array.from(g.data))
  })

  it("transpose maps (x,y)→(y,x)", () => {
    const tr = transpose(g)
    expect(tr.width).toBe(2)
    expect(pixel(tr, 0, 1)).toEqual(pixel(g, 1, 0))
  })

  it("applyOrientation(6) equals rotate90cw", () => {
    const a = applyOrientation(g, 6)
    const b = rotate90(g, "cw")
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})

describe("geometry", () => {
  const g = gradientImage(4, 4)

  it("crop extracts the exact rect", () => {
    const c = crop(g, 1, 1, 2, 2)
    expect(c.width).toBe(2)
    expect(c.height).toBe(2)
    expect(pixel(c, 0, 0)).toEqual(pixel(g, 1, 1))
    expect(pixel(c, 1, 1)).toEqual(pixel(g, 2, 2))
  })

  it("crop clamps out-of-bounds rects", () => {
    const c = crop(g, 3, 3, 5, 5)
    expect(c.width).toBe(1)
    expect(c.height).toBe(1)
  })

  it("resize to same size is identity (same buffer)", () => {
    expect(resizeBilinear(g, 4, 4)).toBe(g)
  })

  it("downscale a solid image preserves the color exactly", () => {
    const s = solidImage(8, 8, [200, 100, 50, 255])
    const d = resizeBilinear(s, 3, 3)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) expect(pixel(d, x, y)).toEqual([200, 100, 50, 255])
  })

  it("upscale midpoint interpolates between neighbor colors", () => {
    // 2x1 image: black | white → 4x1 upscale should contain mid-gray
    const img = makeImage(2, 1, [0, 0, 0, 255, 255, 255, 255, 255])
    const up = resizeBilinear(img, 4, 1)
    const mid = pixel(up, 1, 0)
    expect(mid[0]).toBeGreaterThan(60)
    expect(mid[0]).toBeLessThan(195)
  })

  it("premultiplied resize avoids color bleeding at alpha edges", () => {
    // left half opaque red, right half fully transparent
    const img = makeImage(2, 1, [255, 0, 0, 255, 0, 0, 255, 0])
    const up = resizeBilinear(img, 8, 1)
    // pixel 0 is fully inside the red half — must stay pure red, not purple
    const p = pixel(up, 0, 0)
    expect(p[0]).toBeGreaterThan(240)
    expect(p[2]).toBeLessThan(15)
    expect(p[3]).toBe(255)
  })
})
