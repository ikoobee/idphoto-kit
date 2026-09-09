import type { Orientation } from "./exif.ts"
import { blankImage, type RgbaImage } from "./types.ts"

/**
 * Apply an EXIF orientation to raw pixels, returning a new upright image.
 * Orientation semantics follow the EXIF spec:
 *   1 = normal · 2 = flip-h · 3 = rot180 · 4 = flip-v
 *   5 = transpose · 6 = rot90cw · 7 = transverse · 8 = rot90ccw
 */
export function applyOrientation(img: RgbaImage, o: Orientation | null): RgbaImage {
  if (o === null || o === 1) return img
  switch (o) {
    case 2:
      return flipH(img)
    case 3:
      return rotate180(img)
    case 4:
      return flipV(img)
    case 5:
      return transpose(img)
    case 6:
      return rotate90(img, "cw")
    case 7:
      return transpose(flipH(flipV(img)))
    case 8:
      return rotate90(img, "ccw")
  }
}

/** Horizontal mirror. */
export function flipH(img: RgbaImage): RgbaImage {
  const out = blankImage(img.width, img.height)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * 4
      const dst = (y * img.width + (img.width - 1 - x)) * 4
      for (let c = 0; c < 4; c++) out.data[dst + c] = img.data[src + c]!
    }
  }
  return out
}

/** Vertical mirror. */
export function flipV(img: RgbaImage): RgbaImage {
  const out = blankImage(img.width, img.height)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * 4
      const dst = ((img.height - 1 - y) * img.width + x) * 4
      for (let c = 0; c < 4; c++) out.data[dst + c] = img.data[src + c]!
    }
  }
  return out
}

export function rotate180(img: RgbaImage): RgbaImage {
  const out = blankImage(img.width, img.height)
  const n = img.width * img.height
  for (let p = 0; p < n; p++) {
    const src = p * 4
    const dst = (n - 1 - p) * 4
    for (let c = 0; c < 4; c++) out.data[dst + c] = img.data[src + c]!
  }
  return out
}

/** Rotate by 90° clockwise ("cw") or counter-clockwise ("ccw"). Dimensions swap. */
export function rotate90(img: RgbaImage, dir: "cw" | "ccw"): RgbaImage {
  const out = blankImage(img.height, img.width)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * 4
      const dst =
        dir === "cw"
          ? (x * out.width + (out.width - 1 - y)) * 4 // (x,y) -> (H-1-y, x)
          : ((out.height - 1 - x) * out.width + y) * 4 // (x,y) -> (y, W-1-x)
      for (let c = 0; c < 4; c++) out.data[dst + c] = img.data[src + c]!
    }
  }
  return out
}

/** Reflect across the main diagonal: (x,y) -> (y,x). Dimensions swap. */
export function transpose(img: RgbaImage): RgbaImage {
  const out = blankImage(img.height, img.width)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * 4
      const dst = (x * out.width + y) * 4
      for (let c = 0; c < 4; c++) out.data[dst + c] = img.data[src + c]!
    }
  }
  return out
}
