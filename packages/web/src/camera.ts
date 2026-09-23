import { type RgbaImage, resizeBilinear } from "@idphoto-kit/core"

/**
 * Camera capture: mirrored live preview (what users expect from a selfie
 * camera), un-mirrored capture (what IDs need). Fails loudly on permission /
 * support / insecure-context so the UI can degrade to the upload path.
 */
export class CameraStream {
  private constructor(private readonly stream: MediaStream) {}

  static async open(): Promise<CameraStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    })
    return new CameraStream(stream)
  }

  attach(video: HTMLVideoElement): void {
    video.srcObject = this.stream
    video.play().catch(() => {}) // muted+playsinline keeps autoplay policy happy
  }

  close(): void {
    for (const track of this.stream.getTracks()) track.stop()
  }

  /** Grab the caller's live preview frame as RGBA, un-mirrored, size-capped. */
  captureFrame(video: HTMLVideoElement, maxSide = 1600): RgbaImage {
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 960
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    const ctx = c.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("2D canvas unavailable")
    ctx.translate(w, 0)
    ctx.scale(-1, 1) // the preview is mirrored; restore the true orientation
    ctx.drawImage(video, 0, 0, w, h)
    const id = ctx.getImageData(0, 0, w, h)
    const img = { data: id.data, width: w, height: h }
    const k = maxSide / Math.max(w, h)
    return k < 1 ? resizeBilinear(img, Math.round(w * k), Math.round(h * k)) : img
  }
}
