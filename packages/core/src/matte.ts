import type { RgbaImage } from "./types.ts"

/**
 * Single-channel alpha map (0–255), same pixel grid as the input image.
 * Indexing is row-major [y * width + x].
 */
export type AlphaMat = Uint8ClampedArray

/**
 * Matting adapter contract. Implementations live at the platform layer
 * (browser: MODNet via ONNX Runtime Web; server: BiRefNet). Pure geometry
 * post-processing stays here so every backend gets identical edge behavior.
 */
export interface MattingModel {
  /** Extract a portrait alpha matte of the same dimensions as the input. */
  matte(input: RgbaImage): Promise<AlphaMat>
}

export interface EdgeRefineOptions {
  /** Alpha values below this stay background. Default 0.35. */
  lowCut?: number
  /** Alpha values above this stay foreground. Default 0.65. */
  highCut?: number
  /** Edge feather radius in pixels (small box blur on the transition band). Default 1. */
  feather?: number
}

/**
 * Sharpen the matting transition band and feather it.
 *
 * Raw model output tends to leave a wide 0.3–0.7 alpha ramp around hair and
 * shoulders, which reads as a halo once composited on a flat background.
 * Remapping the ramp into a narrower [lowCut, highCut] smoothstep keeps hair
 * detail while killing the halo, and the feather pass softens the inevitable
 * one-pixel staircase.
 */
export function refineAlpha(
  alpha: AlphaMat,
  width: number,
  height: number,
  opts: EdgeRefineOptions = {},
): AlphaMat {
  const lowCut = opts.lowCut ?? 0.35
  const highCut = opts.highCut ?? 0.65
  const feather = opts.feather ?? 1

  let out = new Uint8ClampedArray(alpha.length)
  const lo = lowCut * 255
  const hi = highCut * 255
  for (let i = 0; i < alpha.length; i++) {
    out[i] = smoothstep(lo, hi, alpha[i]!)
  }

  if (feather > 0) out = featherEdges(out, width, height, feather)
  return out
}

function smoothstep(lo: number, hi: number, v: number): number {
  if (v <= lo) return 0
  if (v >= hi) return 255
  const t = (v - lo) / (hi - lo)
  return Math.round(t * t * (3 - 2 * t) * 255)
}

/**
 * Min-filter erosion of the matte: shrinks the foreground by `radius` pixels.
 * Upscaled low-res masks leave a contaminated rim — subject pixels right at
 * the edge carry the OLD background's color spill (shoulders against a blue
 * wall stay blue-tinted no matter how good the transition un-mixing is).
 * Eroding one pixel moves the composite boundary inside clean subject pixels;
 * the feather band then re-blends the edge against the NEW background.
 */
export function erodeAlpha(alpha: AlphaMat, width: number, height: number, radius = 1): AlphaMat {
  if (radius <= 0) return alpha
  const out = new Uint8ClampedArray(alpha.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) {
          min = 0 // outside the canvas = background
          break
        }
        const row = yy * width
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx
          const v = xx < 0 || xx >= width ? 0 : alpha[row + xx]!
          if (v < min) {
            min = v
            if (min === 0) break
          }
        }
        if (min === 0) break
      }
      out[y * width + x] = min
    }
  }
  return out
}

/** Small box blur applied only on the transition band (0<a<255). */
function featherEdges(a: AlphaMat, w: number, h: number, r: number): AlphaMat {
  const out = new Uint8ClampedArray(a.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = a[i]!
      if (v === 0 || v === 255) {
        out[i] = v
        continue
      }
      let sum = 0
      let n = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += a[yy * w + xx]!
          n++
        }
      }
      out[i] = sum / n
    }
  }
  return out
}
