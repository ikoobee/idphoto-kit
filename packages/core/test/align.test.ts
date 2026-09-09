import { describe, expect, it } from "vitest"
import { planCrop, renderToSpec } from "../src/align.ts"
import { type CropTarget, type FaceLandmarks, type Point, rotateAround } from "../src/face.ts"
import { makeImage, type RgbaImage } from "../src/types.ts"
import { solidImage } from "./helpers.ts"

/** 3×3 marker of a unique color stamped at a point, on a flat gray source. */
function markedSource(
  w: number,
  h: number,
  marks: Array<[Point, [number, number, number]]>,
): RgbaImage {
  const px: number[] = []
  for (let i = 0; i < w * h; i++) px.push(128, 128, 128, 255)
  for (const [p, [r, g, b]] of marks) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = ((Math.round(p.y) + dy) * w + Math.round(p.x) + dx) * 4
        px[i] = r
        px[i + 1] = g
        px[i + 2] = b
        px[i + 3] = 255
      }
  }
  return makeImage(w, h, px)
}

/** Centroid of pixels close to the given color (L1 distance over RGBA). */
function findMarker(img: RgbaImage, [r, g, b]: [number, number, number]): Point {
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const dist =
        Math.abs(img.data[i]! - r) + Math.abs(img.data[i + 1]! - g) + Math.abs(img.data[i + 2]! - b)
      if (dist < 90) {
        sx += x
        sy += y
        n++
      }
    }
  if (n === 0) throw new Error(`marker (${r},${g},${b}) not found`)
  return { x: (sx + n * 0.5) / n, y: (sy + n * 0.5) / n }
}

const target: CropTarget = {
  width: 295,
  height: 413,
  face: { headHeightRatio: [0.55, 0.7], eyeLineRatio: 0.42 },
}

const RED: [number, number, number] = [255, 0, 0]
const GREEN: [number, number, number] = [0, 255, 0]
const BLUE: [number, number, number] = [0, 60, 255]

describe("planCrop", () => {
  const face: FaceLandmarks = {
    eyesCenter: { x: 200, y: 300 },
    eyeLineAngle: 0,
    headTop: { x: 200, y: 150 },
    chin: { x: 200, y: 450 },
  }

  it("scales head to the ratio midpoint", () => {
    const plan = planCrop(face, target)
    // headH = 300, target = 413 × 0.625 = 258.125
    expect(plan.scale).toBeCloseTo(258.125 / 300, 5)
    expect(plan.headHeightRatioTarget).toBeCloseTo(0.625, 5)
  })

  it("places the eye line at the spec ratio", () => {
    expect(planCrop(face, target).eyeY).toBeCloseTo(413 * 0.42, 5)
  })

  it("uses engine defaults when the spec leaves ratios null", () => {
    const bare: CropTarget = {
      width: 100,
      height: 100,
      face: { headHeightRatio: null, eyeLineRatio: null },
    }
    const plan = planCrop(face, bare)
    expect(plan.headHeightRatioTarget).toBeCloseTo(0.625, 5)
    expect(plan.eyeY).toBeCloseTo(42, 5)
  })

  it("warns on large roll", () => {
    const tilted = { ...face, eyeLineAngle: (12 * Math.PI) / 180 }
    const codes = planCrop(tilted, target).warnings.map((w) => w.code)
    expect(codes).toContain("large-roll")
    expect(planCrop(face, target).warnings.map((w) => w.code)).not.toContain("large-roll")
  })

  it("warns on upscaling", () => {
    const small: FaceLandmarks = {
      eyesCenter: { x: 50, y: 75 },
      eyeLineAngle: 0,
      headTop: { x: 50, y: 55 },
      chin: { x: 50, y: 95 },
    } // headH = 40 → scale ≈ 6.45
    expect(planCrop(small, target).warnings.map((w) => w.code)).toContain("upscale")
  })
})

describe("renderToSpec", () => {
  it("renders at spec size with markers anchored to the plan", () => {
    const face: FaceLandmarks = {
      eyesCenter: { x: 200, y: 300 },
      eyeLineAngle: 0,
      headTop: { x: 200, y: 150 },
      chin: { x: 200, y: 450 },
    }
    const src = markedSource(400, 600, [
      [face.eyesCenter, RED],
      [face.headTop, GREEN],
      [face.chin, BLUE],
    ])
    const out = renderToSpec(src, face, target)
    expect(out.width).toBe(295)
    expect(out.height).toBe(413)

    const eye = findMarker(out, RED)
    expect(Math.abs(eye.x - 295 / 2)).toBeLessThan(1) // horizontally centered
    expect(Math.abs(eye.y - 413 * 0.42)).toBeLessThan(1) // eye line at 42%

    const top = findMarker(out, GREEN)
    const chin = findMarker(out, BLUE)
    // head occupies the ratio midpoint of canvas height
    expect((chin.y - top.y) / 413).toBeCloseTo(0.625, 2)
    // and the eye anchor splits it ~50/50 (symmetric synthetic face)
    expect(Math.abs(eye.y - (top.y + chin.y) / 2)).toBeLessThan(2)
  })

  it("counter-rotates a tilted head back to level", () => {
    // physically consistent tilt: eye line AND head axis both lean 10°
    const roll = (10 * Math.PI) / 180
    const c: Point = { x: 200, y: 300 }
    const face: FaceLandmarks = {
      eyesCenter: c,
      eyeLineAngle: roll,
      headTop: rotateAround({ x: 200, y: 150 }, c, roll),
      chin: rotateAround({ x: 200, y: 450 }, c, roll),
    }
    const src = markedSource(400, 600, [
      [face.eyesCenter, RED],
      [face.headTop, GREEN],
      [face.chin, BLUE],
    ])
    const out = renderToSpec(src, face, target)
    const eye = findMarker(out, RED)
    expect(Math.abs(eye.y - 413 * 0.42)).toBeLessThan(1)
    // head vertical extent and upright axis restored despite the 10° roll
    const top = findMarker(out, GREEN)
    const chin = findMarker(out, BLUE)
    expect((chin.y - top.y) / 413).toBeCloseTo(0.625, 2)
    expect(Math.abs(top.x - chin.x)).toBeLessThan(1)
  })

  it("extends the background at out-of-bounds edges (no transparency)", () => {
    // chin near the bottom edge: rows below the photo must repeat edge pixels
    const face: FaceLandmarks = {
      eyesCenter: { x: 200, y: 300 },
      eyeLineAngle: 0,
      headTop: { x: 200, y: 150 },
      chin: { x: 200, y: 560 },
    }
    const out = renderToSpec(solidImage(400, 600, [200, 210, 220, 255]), face, target)
    for (let y = 380; y < 413; y++)
      for (let x = 0; x < 295; x++) {
        const i = (y * 295 + x) * 4
        expect(out.data[i + 3]!).toBe(255)
        expect(Math.abs(out.data[i]! - 200)).toBeLessThan(6)
      }
  })

  it("user adjust: dx/dy shift the anchor on the canvas", () => {
    const face: FaceLandmarks = {
      eyesCenter: { x: 200, y: 300 },
      eyeLineAngle: 0,
      headTop: { x: 200, y: 150 },
      chin: { x: 200, y: 450 },
    }
    const src = markedSource(400, 600, [[face.eyesCenter, RED]])
    const base = renderToSpec(src, face, target)
    const shifted = renderToSpec(src, face, target, { dx: 20, dy: 30 })
    const b = findMarker(base, RED)
    const s = findMarker(shifted, RED)
    expect(s.x - b.x).toBeCloseTo(20, 0)
    expect(s.y - b.y).toBeCloseTo(30, 0)
  })

  it("user adjust: scale zooms around the anchor", () => {
    const face: FaceLandmarks = {
      eyesCenter: { x: 200, y: 300 },
      eyeLineAngle: 0,
      headTop: { x: 200, y: 150 },
      chin: { x: 200, y: 450 },
    }
    const src = markedSource(400, 600, [
      [face.eyesCenter, RED],
      [face.chin, BLUE],
    ])
    const base = renderToSpec(src, face, target)
    const zoomed = renderToSpec(src, face, target, { scale: 1.2 })
    // anchor (eye) stays put; chin moves further down by 20% of its offset
    const eyeB = findMarker(base, RED)
    const chinB = findMarker(base, BLUE)
    const eyeZ = findMarker(zoomed, RED)
    const chinZ = findMarker(zoomed, BLUE)
    expect(Math.abs(eyeZ.y - eyeB.y)).toBeLessThan(1.5)
    expect(chinZ.y - eyeZ.y).toBeCloseTo((chinB.y - eyeB.y) * 1.2, 0)
  })

  it("keeps premultiplied sampling clean across alpha edges", () => {
    // left half: opaque red portrait; right half: transparent (post-matting)
    const px = new Uint8ClampedArray(400 * 600 * 4)
    for (let y = 0; y < 600; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 400 + x) * 4
        px[i] = 255
        px[i + 1] = 0
        px[i + 2] = 0
        px[i + 3] = 255
      }
    const src = { data: px, width: 400, height: 600 }
    const face: FaceLandmarks = {
      eyesCenter: { x: 100, y: 300 },
      eyeLineAngle: 0,
      headTop: { x: 100, y: 150 },
      chin: { x: 100, y: 450 },
    }
    const out = renderToSpec(src, face, target)
    // deep inside the opaque half: pure red, fully opaque
    const p = ((planCrop(face, target).eyeY | 0) * 295 + 10) * 4
    expect(out.data[p]!).toBeGreaterThan(245)
    expect(out.data[p + 2]!).toBeLessThan(10)
    expect(out.data[p + 3]!).toBe(255)
  })
})
