import { type RgbaImage, resizeBilinear } from "@idphoto-kit/core"

/** MODNet PPM-512 input resolution (square). */
export const MODNET_INPUT_SIZE = 512

export interface ModnetInput {
  /** CHW float32 plane, normalized to [-1, 1] ((v/255 − 0.5) / 0.5). */
  data: Float32Array
  dims: [number, number, number, number]
}

/**
 * Preprocess an RGBA image into a MODNet input tensor: bilinear downscale to
 * 512×512, ImageNet-style (0.5, 0.5, 0.5) normalization, HWC → CHW layout.
 * Pure — unit-testable without ONNX Runtime.
 */
export function buildModnetInput(img: RgbaImage, size = MODNET_INPUT_SIZE): ModnetInput {
  const scaled = resizeBilinear(img, size, size)
  const src = scaled.data
  const data = new Float32Array(3 * size * size)
  const norm = (i: number) => ((src[i] ?? 0) / 255 - 0.5) / 0.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgba = (y * size + x) * 4
      const chw = y * size + x
      data[chw] = norm(rgba) // R plane
      data[size * size + chw] = norm(rgba + 1) // G plane
      data[2 * size * size + chw] = norm(rgba + 2) // B plane
    }
  }
  return { data, dims: [1, 3, size, size] }
}

/**
 * Postprocess the [1,1,size,size] alpha output back to the original image
 * grid: clamp to [0,1], scale to 0–255, bilinear upscale. Pure.
 */
export function alphaFromModnetOutput(
  output: Float32Array,
  size: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height)
  const sx = size / width
  const sy = size / height
  const at = (x: number, y: number) => {
    const v = output[y * size + x]
    return v === undefined ? 0 : Math.min(1, Math.max(0, v))
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.min(size - 1, (y + 0.5) * sy - 0.5)
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(size - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(size - 1, (x + 0.5) * sx - 0.5)
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(size - 1, x0 + 1)
      const wx = fx - x0
      const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * wx
      const bot = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * wx
      out[y * width + x] = (top + (bot - top) * wy) * 255
    }
  }
  return out
}
