import type { JpegEncoder, RgbaImage } from "@idphoto-kit/core"

/** Paint an RgbaImage onto a fresh canvas (straight alpha via putImageData). */
export function imageToCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext("2d")
  if (!ctx) throw new Error("2D canvas unavailable")
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return c
}

function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error(`encode as ${type} failed`))
          return
        }
        b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)))
      },
      type,
      quality,
    ),
  )
}

/** JPEG encoder bound to an image — feeds fitJpegToTargetKB. */
export function makeJpegEncoder(img: RgbaImage): JpegEncoder {
  const canvas = imageToCanvas(img)
  return (quality) => canvasToBytes(canvas, "image/jpeg", quality)
}

/** Straight-alpha PNG export (transparent background). */
export function encodePng(img: RgbaImage): Promise<Uint8Array> {
  return canvasToBytes(imageToCanvas(img), "image/png")
}

/** Plain download helper for encoded bytes. */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes], { type: mime })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}
