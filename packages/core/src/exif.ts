/**
 * Minimal JPEG EXIF orientation reader. Pure function over bytes — no IO.
 *
 * Why hand-rolled: we only need the Orientation tag (0x0112) from IFD0 inside
 * the APP1 "Exif" segment; pulling in a full EXIF library for one tag is not
 * worth the dependency weight. Covers baseline JPEGs from every mainstream
 * camera/phone that writes orientation.
 */

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

/** DataView over the exact byte range (handles non-zero byteOffset). */
function view(bytes: Uint8Array): DataView | null {
  try {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } catch {
    return null
  }
}

/** Locate the APP1 Exif payload (just past "Exif\0\0"), or -1. */
function findApp1(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1 // not a JPEG (SOI)
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return -1 // desync
    const marker = bytes[pos + 1]!
    if (marker === 0xda || marker === 0xd9) return -1 // SOS/EOI — no APP1 found
    const segLen = (bytes[pos + 2]! << 8) | bytes[pos + 3]!
    if (marker === 0xe1) {
      const payload = pos + 4
      for (let i = 0; i < EXIF_HEADER.length; i++) {
        if (bytes[payload + i] !== EXIF_HEADER[i]) break
        if (i === EXIF_HEADER.length - 1) return payload + EXIF_HEADER.length
      }
    }
    pos += 2 + segLen
  }
  return -1
}

/**
 * Read the EXIF Orientation (1–8). Returns null when absent or unparsable —
 * callers treat null as "upright, no transform needed".
 */
export function readJpegOrientation(bytes: Uint8Array): Orientation | null {
  const dv = view(bytes)
  if (!dv) return null
  const tiff = findApp1(bytes)
  if (tiff < 0 || tiff + 8 > bytes.length) return null

  const byteOrder = dv.getUint16(tiff)
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null // "II" / "MM"
  const little = byteOrder === 0x4949
  if (dv.getUint16(tiff + 2, little) !== 42) return null // TIFF magic

  const ifd0 = dv.getUint32(tiff + 4, little) // relative to TIFF header
  const dir = tiff + ifd0
  if (dir + 2 > bytes.length) return null
  const entries = dv.getUint16(dir, little)
  for (let i = 0; i < entries; i++) {
    const e = dir + 2 + i * 12
    if (e + 12 > bytes.length) return null
    const tag = dv.getUint16(e, little)
    const type = dv.getUint16(e + 2, little)
    if (tag === 0x0112 && type === 3) {
      const v = dv.getUint16(e + 8, little) // SHORT values are inline, left-justified
      return v >= 1 && v <= 8 ? (v as Orientation) : null
    }
  }
  return null
}
