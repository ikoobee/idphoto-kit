import type { FaceLandmarks as CoreFaceLandmarks, RgbaImage } from "@idphoto-kit/core"
import { imageToCanvas } from "../encode.ts"

/**
 * MediaPipe FaceLandmarker adapter — the browser-side implementation of the
 * core FaceLandmarks contract. WASM runtime + model are fetched from the
 * official CDN on first use (no image data is ever sent anywhere); the
 * instance is reused across detections.
 *
 * Landmark indices (canonical face mesh):
 *   33 / 263 — outer eye corners → eye anchor + roll
 *   10 / 152 — forehead top / chin → head height
 */
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

type MediaPipe = typeof import("@mediapipe/tasks-vision")

export class MediaPipeFace {
  private instance: Promise<Instance> | null = null

  private async load(): Promise<Instance> {
    this.instance ??= (async () => {
      const mp: MediaPipe = await import("@mediapipe/tasks-vision")
      const fileset = await mp.FilesetResolver.forVisionTasks(WASM_CDN)
      const make = (delegate: "GPU" | "CPU") =>
        mp.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "IMAGE",
          numFaces: 1,
        })
      try {
        return { landmarker: await make("GPU"), mp }
      } catch {
        return { landmarker: await make("CPU"), mp }
      }
    })()
    return this.instance
  }

  /** Detect face landmarks, or null when no (single) face is found. */
  async detect(img: RgbaImage): Promise<CoreFaceLandmarks | null> {
    const { landmarker } = await this.load()
    const result = landmarker.detect(imageToCanvas(img))
    const face = result.faceLandmarks?.[0]
    if (!face) return null

    const px = (i: number) => ({ x: face[i]!.x * img.width, y: face[i]!.y * img.height })
    const right = px(33)
    const left = px(263)
    const eyesCenter = { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 }
    return {
      eyesCenter,
      eyeLineAngle: Math.atan2(left.y - right.y, left.x - right.x),
      headTop: px(10),
      chin: px(152),
    }
  }
}

interface Instance {
  landmarker: import("@mediapipe/tasks-vision").FaceLandmarker
  mp: MediaPipe
}
