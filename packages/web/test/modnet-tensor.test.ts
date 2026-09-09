import { makeImage } from "@idphoto-kit/core"
import { describe, expect, it } from "vitest"
import {
  alphaFromModnetOutput,
  buildModnetInput,
  MODNET_INPUT_SIZE,
} from "../src/models/modnet-tensor.ts"

describe("buildModnetInput", () => {
  it("produces NCHW float32 planes with correct dims", () => {
    const img = makeImage(4, 4, new Array(4 * 4 * 4).fill(128))
    const input = buildModnetInput(img, 8)
    expect(input.dims).toEqual([1, 3, 8, 8])
    expect(input.data.length).toBe(3 * 8 * 8)
  })

  it("normalizes black to -1 and white to +1 (solid images stay solid)", () => {
    const black = makeImage(
      2,
      2,
      new Array(2 * 2 * 4).fill(0).map((v, i) => (i % 4 === 3 ? 255 : v)),
    )
    const white = makeImage(2, 2, new Array(2 * 2 * 4).fill(255))
    const b = buildModnetInput(black, 4)
    const w = buildModnetInput(white, 4)
    for (const v of b.data) expect(Math.abs(v - -1)).toBeLessThan(0.01)
    for (const v of w.data) expect(Math.abs(v - 1)).toBeLessThan(0.01)
  })

  it("keeps channel planes separate (CHW, not interleaved)", () => {
    // pure red: R plane high, G/B planes low
    const px = new Array(16 * 4).fill(0).map((_, i) => (i % 4 === 0 ? 255 : i % 4 === 3 ? 255 : 0))
    const input = buildModnetInput(makeImage(4, 4, px), 4)
    const plane = 4 * 4
    for (let i = 0; i < plane; i++) {
      expect(input.data[i]!).toBeGreaterThan(0.9) // R
      expect(input.data[plane + i]!).toBeLessThan(-0.9) // G
      expect(input.data[2 * plane + i]!).toBeLessThan(-0.9) // B
    }
  })
})

describe("alphaFromModnetOutput", () => {
  it("upscales a 512 half/half matte to an arbitrary grid", () => {
    const size = MODNET_INPUT_SIZE
    const out512 = new Float32Array(size * size)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) out512[y * size + x] = x < size / 2 ? 1 : 0
    const alpha = alphaFromModnetOutput(out512, size, 300, 200)
    expect(alpha.length).toBe(300 * 200)
    expect(alpha[0]).toBe(255) // far left fully foreground
    expect(alpha[299]).toBe(0) // far right fully background
    // with sx≈1.71 the source step lands between output x=149 and x=150
    expect(alpha[140]).toBe(255)
    expect(alpha[160]).toBe(0)
  })

  it("clamps model overshoot into the 0–255 byte range", () => {
    // identity scale (size == width == height) so sampling is exact per pixel
    const out = new Float32Array(16).fill(0.5)
    out[0] = 1.4
    out[15] = -0.3
    const alpha = alphaFromModnetOutput(out, 4, 4, 4)
    expect(alpha[0]).toBe(255)
    expect(alpha[15]).toBe(0)
    expect(alpha[5]).toBe(128) // untouched mid value scales through
  })
})
