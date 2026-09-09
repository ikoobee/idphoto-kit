/**
 * Target-size JPEG export: binary-search the encoder quality until the output
 * fits a byte budget WITHOUT touching pixel dimensions — exam portals reject
 * resized images, so quality is the only legal lever.
 *
 * The encoder is injected: browsers pass a canvas.toBlob adapter, servers an
 * imaging-library adapter; core stays free of platform APIs and the search
 * logic stays fully testable.
 */

/** Encodes the image at a JPEG quality (0–1) and returns the encoded bytes. */
export type JpegEncoder = (quality: number) => Promise<Uint8Array>

export interface FitOptions {
  /** Lower bound of the search range. Below this, block artifacts dominate. Default 0.3. */
  minQuality?: number
  /** Upper bound. Default 0.95. */
  maxQuality?: number
  /** Binary-search steps. Default 8 (resolution ≈ (max−min)/2⁸). */
  maxIterations?: number
}

export interface TargetFitResult {
  bytes: Uint8Array
  quality: number
  /** True when bytes fit within targetKB. False → caller must warn the user. */
  fits: boolean
}

/**
 * Find the highest quality whose encoding fits `targetKB`, or report failure.
 * Monotonicity of size(q) makes plain bisection correct; we keep the best
 * fitting candidate seen and never return an over-budget blob as "fits".
 */
export async function fitJpegToTargetKB(
  encode: JpegEncoder,
  targetKB: number,
  opts: FitOptions = {},
): Promise<TargetFitResult> {
  const minQ = opts.minQuality ?? 0.3
  const maxQ = opts.maxQuality ?? 0.95
  const iterations = opts.maxIterations ?? 8
  const budget = targetKB * 1024

  // Quality-first: if even the ceiling fits, ship the ceiling untouched.
  const atMax = await encode(maxQ)
  if (atMax.byteLength <= budget) {
    return { bytes: atMax, quality: maxQ, fits: true }
  }

  let lo = minQ
  let hi = maxQ
  let best: { bytes: Uint8Array; quality: number } | null = null
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    const bytes = await encode(mid)
    if (bytes.byteLength <= budget) {
      best = { bytes, quality: mid }
      lo = mid // feasible → try higher quality
    } else {
      hi = mid // over budget → lower quality
    }
  }

  if (best) return { ...best, fits: true }
  const floorBytes = await encode(minQ)
  return { bytes: floorBytes, quality: minQ, fits: floorBytes.byteLength <= budget }
}
