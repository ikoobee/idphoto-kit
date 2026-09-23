import type { RgbaImage } from "./types.ts"

/** Tone controls layered on the portrait before compositing. */
export interface ColorAdjust {
  /** Multiplier around mid-gray. 1 = unchanged. Default 1. */
  brightness?: number
  /** Spread around mid-gray. 0 flattens to gray, 1 = unchanged. Default 1. */
  contrast?: number
}

/**
 * Brightness / contrast in one pass around the 128 mid-gray pivot, alpha
 * untouched. Identity adjustments return the input unchanged (no copy) so the
 * hot preview path stays allocation-free while sliders rest at their defaults.
 */
export function adjustColors(img: RgbaImage, adj: ColorAdjust = {}): RgbaImage {
  const brightness = adj.brightness ?? 1
  const contrast = adj.contrast ?? 1
  if (brightness === 1 && contrast === 1) return img
  const k = contrast * brightness
  const out = new Uint8ClampedArray(img.data)
  for (let p = 0; p < out.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      out[p + c] = (out[p + c]! - 128) * k + 128
    }
  }
  return { data: out, width: img.width, height: img.height }
}
