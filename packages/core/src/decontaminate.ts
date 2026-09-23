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
    // Uint8ClampedArray clamps the overshoot that strong un-mixing produces
    out[p] = (img.data[p]! - inv * bg[0]) / a
    out[p + 1] = (img.data[p + 1]! - inv * bg[1]) / a
    out[p + 2] = (img.data[p + 2]! - inv * bg[2]) / a
  }
  return { data: out, width: img.width, height: img.height }
}
