import type { AlphaMat } from "./matte.ts"
import type { RgbaImage } from "./types.ts"

/**
 * Edge decontamination: kill the old-background fringe on matted portraits.
 *
 * Semi-transparent edge pixels are a mix of subject and the ORIGINAL
 * background color — composited onto a new background that mix reads as a
 * halo (a blue-bg photo swapped to white shows a pale blue rim around the
 * hair). Given the estimated source background color, the subject color can
 * be solved back out: I = α·F + (1−α)·B → F = (I − (1−α)·B) / α.
 * Only the transition band is touched; core subject pixels pass through.
 */

/** Average color of clearly-background pixels (alpha < threshold). */
export function estimateBackgroundColor(
  img: RgbaImage,
  alpha: AlphaMat,
  opts: { threshold?: number; stride?: number } = {},
): [number, number, number] | null {
  const threshold = (opts.threshold ?? 0.12) * 255
  const stride = Math.max(1, opts.stride ?? 4)
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < alpha.length; i += stride) {
    if (alpha[i]! < threshold) {
      r += img.data[i * 4]!
      g += img.data[i * 4 + 1]!
      b += img.data[i * 4 + 2]!
      n++
    }
  }
  return n > 0 ? [r / n, g / n, b / n] : null
}

export interface DecontaminateOptions {
  /** Alpha band (0–1) treated as mixed edge pixels. Default [0.05, 0.95]. */
  band?: [number, number]
}

/**
 * Un-mix the background color out of the transition band. Returns a fresh
 * image; the input is never mutated. Alpha is untouched.
 *
 * The correction is bounded by how much background could actually be present
 * ((1−α)·255, plus headroom): unbounded un-mixing overshoots on already-clean
 * pixels and leaves a rim BRIGHTER than both sides — the classic halo line.
 */
export function decontaminateEdges(
  img: RgbaImage,
  alpha: AlphaMat,
  bg: [number, number, number],
  opts: DecontaminateOptions = {},
): RgbaImage {
  const [lo, hi] = opts.band ?? [0.05, 0.95]
  const out = new Uint8ClampedArray(img.data)
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]! / 255
    if (a <= lo || a >= hi) continue
    const p = i * 4
    const inv = 1 - a
    const maxShift = inv * 255 + 30 // physical bound on the bg contribution
    for (let c = 0; c < 3; c++) {
      const raw = (img.data[p + c]! - inv * bg[c]!) / a
      const delta = raw - img.data[p + c]!
      const clamped = img.data[p + c]! + Math.max(-maxShift, Math.min(maxShift, delta))
      out[p + c] = clamped
    }
  }
  return { data: out, width: img.width, height: img.height }
}
