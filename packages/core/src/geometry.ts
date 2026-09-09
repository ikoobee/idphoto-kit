import { blankImage, type RgbaImage } from "./types.ts"

/**
 * Crop to a rectangle. Negative origins / oversized rects are clamped to the
 * image bounds; the returned size is the clamped intersection.
 */
export function crop(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(img.width, x0 + Math.max(0, Math.floor(w)))
  const y1 = Math.min(img.height, y0 + Math.max(0, Math.floor(h)))
  const out = blankImage(Math.max(0, x1 - x0), Math.max(0, y1 - y0))
  for (let yy = y0; yy < y1; yy++) {
    const rowSrc = (yy * img.width + x0) * 4
    const rowDst = (yy - y0) * out.width * 4
    out.data.set(img.data.subarray(rowSrc, rowSrc + out.width * 4), rowDst)
  }
  return out
}

/**
 * Bilinear resize with premultiplied-alpha interpolation — straight RGBA
 * interpolation would darken halos around semi-transparent edges (hair after
 * matting), which matters a lot for ID photos.
 */
export function resizeBilinear(img: RgbaImage, w: number, h: number): RgbaImage {
  w = Math.max(1, Math.floor(w))
  h = Math.max(1, Math.floor(h))
  if (img.width === w && img.height === h) return img
  const out = blankImage(w, h)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5)
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(img.height - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5)
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(img.width - 1, x0 + 1)
      const wx = fx - x0

      const p00 = (y0 * img.width + x0) * 4
      const p01 = (y0 * img.width + x1) * 4
      const p10 = (y1 * img.width + x0) * 4
      const p11 = (y1 * img.width + x1) * 4
      const dst = (y * w + x) * 4

      // premultiplied bilinear for RGB, straight bilinear for A
      for (let c = 0; c < 3; c++) {
        const a00 = img.data[p00 + 3]! / 255
        const a01 = img.data[p01 + 3]! / 255
        const a10 = img.data[p10 + 3]! / 255
        const a11 = img.data[p11 + 3]! / 255
        const v00 = img.data[p00 + c]! * a00
        const v01 = img.data[p01 + c]! * a01
        const v10 = img.data[p10 + c]! * a10
        const v11 = img.data[p11 + c]! * a11
        const top = v00 + (v01 - v00) * wx
        const bot = v10 + (v11 - v10) * wx
        const premul = top + (bot - top) * wy
        const aTop = a00 + (a01 - a00) * wx
        const aBot = a10 + (a11 - a10) * wx
        const alpha = aTop + (aBot - aTop) * wy
        out.data[dst + c] = alpha < 1e-6 ? 0 : premul / alpha
      }
      const a00 = img.data[p00 + 3]!
      const a01 = img.data[p01 + 3]!
      const a10 = img.data[p10 + 3]!
      const a11 = img.data[p11 + 3]!
      const aTop = a00 + (a01 - a00) * wx
      const aBot = a10 + (a11 - a10) * wx
      out.data[dst + 3] = aTop + (aBot - aTop) * wy
    }
  }
  return out
}
