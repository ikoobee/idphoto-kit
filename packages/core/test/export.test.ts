import { describe, expect, it } from "vitest"
import { fitJpegToTargetKB, type JpegEncoder } from "../src/export.ts"

/** Deterministic mock: size(KB) = 50 + 200·q² — monotonic in quality. */
const mockEncoder: JpegEncoder = async (q) => {
  const kb = 50 + 200 * q * q
  const bytes = new Uint8Array(Math.round(kb * 1024))
  return bytes
}

describe("fitJpegToTargetKB", () => {
  it("ships max quality untouched when the ceiling already fits", async () => {
    const r = await fitJpegToTargetKB(mockEncoder, 500)
    expect(r.quality).toBe(0.95)
    expect(r.fits).toBe(true)
    expect(r.bytes.byteLength).toBe(Math.round((50 + 200 * 0.95 * 0.95) * 1024))
  })

  it("bisects to the quality boundary that just fits", async () => {
    // size(q) = 50+200q² = 100 → q = 0.5
    const r = await fitJpegToTargetKB(mockEncoder, 100)
    expect(r.fits).toBe(true)
    expect(Math.abs(r.quality - 0.5)).toBeLessThan(0.01)
    expect(r.bytes.byteLength).toBeLessThanOrEqual(100 * 1024)
  })

  it("never reports fits for an impossible budget", async () => {
    // even q=0.3 gives 50+200·0.09 = 68KB → a 20KB budget cannot be met
    const r = await fitJpegToTargetKB(mockEncoder, 20)
    expect(r.fits).toBe(false)
    expect(r.quality).toBe(0.3) // floor result returned for the caller to warn
  })

  it("prefers the highest feasible quality, not the last probed", async () => {
    const r = await fitJpegToTargetKB(mockEncoder, 235) // ceiling (0.95 → 230.5KB) fits
    expect(r.quality).toBe(0.95)
    const r2 = await fitJpegToTargetKB(mockEncoder, 150) // 50+200q²=150 → q ≈ 0.7071
    expect(r2.quality).toBeGreaterThan(0.69)
    expect(r2.quality).toBeLessThan(0.72)
  })

  it("respects a custom range and iteration budget", async () => {
    const calls: number[] = []
    const counting: JpegEncoder = async (q) => {
      calls.push(q)
      return new Uint8Array(Math.round((50 + 200 * q * q) * 1024))
    }
    const r = await fitJpegToTargetKB(counting, 100, {
      minQuality: 0.4,
      maxQuality: 0.9,
      maxIterations: 4,
    })
    expect(r.fits).toBe(true)
    expect(calls.length).toBeLessThanOrEqual(6) // 1 ceiling + 4 probes + 0 floor (fits)
  })
})
