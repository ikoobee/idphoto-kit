import { makeImage, type RgbaImage } from "../src/types.ts"

/** Deterministic gradient test image — pixel value encodes position. */
export function gradientImage(width: number, height: number): RgbaImage {
  const px: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      px.push(
        Math.round((x * 255) / Math.max(1, width - 1)),
        Math.round((y * 255) / Math.max(1, height - 1)),
        ((x + y) * 7) % 256,
        255,
      )
    }
  }
  return makeImage(width, height, px)
}

/** Fully-opaque single-color image. */
export function solidImage(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): RgbaImage {
  const px: number[] = []
  for (let i = 0; i < width * height; i++) px.push(...rgba)
  return makeImage(width, height, px)
}

export function pixel(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

/** Build a minimal JPEG carrying an EXIF orientation (II byte order, IFD0). */
export function jpegWithOrientation(orientation: number): Uint8Array {
  const tiff: number[] = [
    0x49,
    0x49, // "II"
    0x2a,
    0x00, // TIFF magic 42
    0x08,
    0x00,
    0x00,
    0x00, // IFD0 at offset 8
    0x01,
    0x00, // 1 entry
    0x12,
    0x01, // tag 0x0112 Orientation
    0x03,
    0x00, // type SHORT
    0x01,
    0x00,
    0x00,
    0x00, // count 1
    orientation & 0xff,
    0x00,
    0x00,
    0x00, // inline value
    0x00,
    0x00,
    0x00,
    0x00, // next-IFD offset
  ]
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  const segLen = payload.length + 2
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1,
    (segLen >> 8) & 0xff,
    segLen & 0xff, // APP1 marker + length
    ...payload,
    0xff,
    0xd9, // EOI
  ])
}
