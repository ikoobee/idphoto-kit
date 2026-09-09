/**
 * Self-describing RGBA image. Structurally compatible with the DOM ImageData
 * (data / width / height), but carries no DOM dependency — the core pipeline
 * runs identically in browser, Node, and workers.
 */
export interface RgbaImage {
  readonly data: Uint8ClampedArray // RGBA8, length = width * height * 4
  readonly width: number
  readonly height: number
}

/** Allocate a blank (fully transparent) image. */
export function blankImage(width: number, height: number): RgbaImage {
  return { data: new Uint8ClampedArray(width * height * 4), width, height }
}

/** Build an image from a flat pixel array. Throws on size mismatch. */
export function makeImage(
  width: number,
  height: number,
  data: ArrayLike<number> | Uint8ClampedArray,
): RgbaImage {
  if (data.length !== width * height * 4) {
    throw new Error(`pixel data length ${data.length} != ${width}*${height}*4`)
  }
  const arr = data instanceof Uint8ClampedArray ? data : Uint8ClampedArray.from(data)
  return { data: arr, width, height }
}

/** Wrap a DOM ImageData-like object without copying. */
export function fromImageData(id: {
  data: Uint8ClampedArray
  width: number
  height: number
}): RgbaImage {
  return makeImage(id.width, id.height, id.data)
}

/** Clone into a mutable copy (pixel buffers are always freshly allocated here). */
export function cloneImage(img: RgbaImage): RgbaImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }
}
