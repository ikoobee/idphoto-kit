import { type AlphaMat, type MattingModel, type RgbaImage, refineAlpha } from "@idphoto-kit/core"
import { imageToCanvas } from "../encode.ts"

/**
 * Default matting tier: MediaPipe Selfie Segmentation — the same official CDN
 * and Apache-2.0 family as the face landmarker, ~250KB, no Release asset to
 * publish, so background swap and outfit patching work out of the box.
 *
 * The higher-fidelity MODNet ONNX tier (hair-level edges) stays available via
 * the manifest chain and becomes the default once models-v0 ships; both
 * implement the same core MattingModel contract, so the pipeline doesn't care.
 */
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"

type MediaPipe = typeof import("@mediapipe/tasks-vision")

export class SelfieSegmenterMatte implements MattingModel {
  private instance: Promise<import("@mediapipe/tasks-vision").ImageSegmenter> | null = null

  /** Drop a failed load so a user-triggered retry starts clean. */
  reset(): void {
    this.instance = null
  }

  private async load() {
    this.instance ??= (async () => {
      const mp: MediaPipe = await import("@mediapipe/tasks-vision")
      const fileset = await mp.FilesetResolver.forVisionTasks(WASM_CDN)
      const make = (delegate: "GPU" | "CPU") =>
        mp.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "IMAGE",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        })
      try {
        return await make("GPU")
      } catch {
        return await make("CPU")
      }
    })()
    // A rejected promise would otherwise be cached forever — clear it so the
    // next call (or an explicit reset) retries.
    this.instance.catch(() => {
      this.instance = null
    })
    return this.instance
  }

  async matte(input: RgbaImage): Promise<AlphaMat> {
    const segmenter = await this.load()
    const result = segmenter.segment(imageToCanvas(input))
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) throw new Error("selfie segmenter returned no confidence mask")
      const alpha = upscaleMaskToAlpha(mask, input.width, input.height)
      // wide transition band + real feather: a hard 1px cut reads as a pasted
      // line against flat backgrounds; decontamination cleans the residual
      // fringe that a wider band lets through
      // feather scaled to the upscaled mask's cell size (~source/256 px):
      // a fixed 2px blur can't smooth the staircase a 256-grid leaves on a
      // 1600px source, which reads as blocky color bands along the edges
      const cell = Math.max(input.width, input.height) / 256
      return refineAlpha(alpha, input.width, input.height, {
        lowCut: 0.3,
        highCut: 0.7,
        feather: Math.max(2, Math.round(cell * 0.8)),
      })
    } finally {
      result.close()
    }
  }
}

interface MaskLike {
  width: number
  height: number
  getAsFloat32Array(): Float32Array
  getAsUint8Array(): Uint8Array
}

/**
 * The model emits a confidence mask at its own (low) resolution — grayscale
 * it, bilinear-upscale to the input grid via the canvas, and lift the red
 * channel as the alpha matte. Confidence 0..1 maps to 0..255; the uint8
 * fallback is 0/1, which the same multiply handles.
 */
function upscaleMaskToAlpha(mask: MaskLike, width: number, height: number): AlphaMat {
  let conf: Float32Array | Uint8Array
  try {
    conf = mask.getAsFloat32Array()
  } catch {
    conf = mask.getAsUint8Array()
  }
  const mw = mask.width
  const mh = mask.height

  const small = document.createElement("canvas")
  small.width = mw
  small.height = mh
  const sctx = small.getContext("2d")
  if (!sctx) throw new Error("2D canvas unavailable")
  const gray = sctx.createImageData(mw, mh)
  for (let i = 0; i < conf.length; i++) {
    const v = (conf[i] ?? 0) * 255
    gray.data[i * 4] = v
    gray.data[i * 4 + 1] = v
    gray.data[i * 4 + 2] = v
    gray.data[i * 4 + 3] = 255
  }
  sctx.putImageData(gray, 0, 0)

  const big = document.createElement("canvas")
  big.width = width
  big.height = height
  const bctx = big.getContext("2d", { willReadFrequently: true })
  if (!bctx) throw new Error("2D canvas unavailable")
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = "high"
  bctx.drawImage(small, 0, 0, width, height)

  const scaled = bctx.getImageData(0, 0, width, height)
  const alpha = new Uint8ClampedArray(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = scaled.data[i * 4]
  return alpha
}
