import {
  type AlphaMat,
  adjustColors,
  type BackgroundOption,
  buildOutfitShapes,
  type ColorAdjust,
  type CropAdjust,
  type CropTarget,
  composeBackground,
  decontaminateEdges,
  estimateBackgroundColor,
  type FaceLandmarks,
  garmentBase,
  mergeOutfitLayer,
  type OutfitId,
  type RgbaImage,
  renderToSpec,
  resizeBilinear,
  restyleGarment,
  type SilhouetteMetrics,
} from "@idphoto-kit/core"
import { compositeOver, renderOutfitLayer } from "./outfit-render.ts"

/**
 * Edit pipeline wiring: tone → outfit patch → edge decontamination →
 * background composite → spec render. Everything here is synchronous pixel
 * work over core pure functions; models (face / matte) run before, at capture
 * time.
 */
export interface EditOptions {
  tone: ColorAdjust
  outfit: OutfitId | null
  bg: BackgroundOption
  adjust: CropAdjust
}

export interface Prepared {
  face: FaceLandmarks | null
  alpha: AlphaMat | null
  silhouette: SilhouetteMetrics | null
}

/**
 * Composite the source onto the chosen background at source resolution
 * (cutout). When no matte is available the original pixels pass through and
 * renderToSpec's edge extension provides a clean background instead.
 */
export function composePortrait(
  source: RgbaImage,
  prepared: Prepared,
  opts: EditOptions,
): RgbaImage {
  const toned = adjustColors(source, opts.tone)
  if (!prepared.alpha) return toned

  // the old background's average color — the source of edge halos
  const oldBg = estimateBackgroundColor(toned, prepared.alpha)

  let portrait = toned
  let alpha = prepared.alpha
  if (opts.outfit && prepared.silhouette) {
    const sil = prepared.silhouette
    const seamFeather = Math.max(14, sil.headH * 0.16)
    const fromLeft = lightFromLeft(toned, prepared.alpha, sil)
    const skin = estimateSkinTone(toned, prepared.alpha, sil)
    // v4: restyle the person's own clothing (wrinkles/lighting preserved),
    // then lay the vector accents (collar/lapels/tie/hood) on top
    const body = restyleGarment(toned, prepared.alpha, {
      base: garmentBase(opts.outfit),
      seamY: sil.shoulderY,
      feather: seamFeather,
      outline: sil.outline,
      bbox: sil.bbox,
      lightFromLeft: fromLeft,
    })
    const accents = renderOutfitLayer(
      buildOutfitShapes(opts.outfit, sil, source.height, { skin }),
      source.width,
      source.height,
      { lightFromLeft: fromLeft },
    )
    const layer = compositeOver(body, accents)
    const merged = mergeOutfitLayer(toned, alpha, layer, sil.shoulderY, seamFeather)
    portrait = merged.portrait
    alpha = merged.alpha
  }

  if (oldBg) portrait = decontaminateEdges(portrait, alpha, oldBg, { band: [0.02, 0.98] })
  return composeBackground(portrait, alpha, opts.bg)
}

/** Average color of solidly-foreground pixels inside the head box. */
function estimateSkinTone(
  img: RgbaImage,
  alpha: AlphaMat,
  sil: SilhouetteMetrics,
): [number, number, number] {
  const y1 = Math.min(sil.chinY ?? sil.bbox.y0 + sil.headH, img.height)
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = sil.bbox.y0; y < y1; y += 2) {
    for (let x = sil.bbox.x0; x <= sil.bbox.x1; x += 2) {
      const i = y * img.width + x
      if ((alpha[i] ?? 255) < 200) continue
      r += img.data[i * 4] ?? 0
      g += img.data[i * 4 + 1] ?? 0
      b += img.data[i * 4 + 2] ?? 0
      n++
    }
  }
  return n > 0 ? [r / n, g / n, b / n] : [229, 181, 140]
}

/** Which side of the head is brighter — garment gradients follow the light. */
function lightFromLeft(img: RgbaImage, alpha: AlphaMat, sil: SilhouetteMetrics): boolean {
  const y1 = Math.min(sil.chinY ?? sil.bbox.y0 + sil.headH, img.height)
  const midX = (sil.bbox.x0 + sil.bbox.x1) / 2
  let lLuma = 0
  let rLuma = 0
  let ln_ = 0
  let rn = 0
  for (let y = sil.bbox.y0; y < y1; y += 3) {
    for (let x = sil.bbox.x0; x <= sil.bbox.x1; x += 3) {
      const i = y * img.width + x
      if ((alpha[i] ?? 255) < 200) continue
      const l =
        0.299 * (img.data[i * 4] ?? 0) +
        0.587 * (img.data[i * 4 + 1] ?? 0) +
        0.114 * (img.data[i * 4 + 2] ?? 0)
      if (x < midX) {
        lLuma += l
        ln_++
      } else {
        rLuma += l
        rn++
      }
    }
  }
  if (ln_ === 0 || rn === 0) return true
  return lLuma / ln_ >= rLuma / rn
}

/** Scale the cutout onto the spec canvas (face-anchored, or center fallback). */
export function renderSpecImage(
  cutout: RgbaImage,
  face: FaceLandmarks | null,
  target: CropTarget,
  adjust: CropAdjust,
): RgbaImage {
  return face
    ? renderToSpec(cutout, face, target, adjust)
    : fitCenter(cutout, target.width, target.height)
}

/** Center crop to the target aspect (cover, slight upward bias), exact px. */
export function fitCenter(img: RgbaImage, width: number, height: number): RgbaImage {
  const targetAspect = width / height
  const srcAspect = img.width / img.height
  let w = img.width
  let h = img.height
  if (srcAspect > targetAspect) w = Math.round(img.height * targetAspect)
  else h = Math.round(img.width / targetAspect)
  const x = Math.floor((img.width - w) / 2)
  const y = Math.max(0, Math.floor((img.height - h) / 2) - Math.round(h * 0.1))
  const cropped = cropView(img, x, y, w, h)
  return cropped.width === width && cropped.height === height
    ? cropped
    : resizeBilinear(cropped, width, height)
}

/** Copy a rectangular region into a fresh image (crop without views). */
function cropView(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * img.width + x) * 4
    out.set(img.data.subarray(srcStart, srcStart + w * 4), row * w * 4)
  }
  return { data: out, width: w, height: h }
}

/** JPEG size estimate (KB) at the preview quality — feeds the check list. */
export async function measureJpegKB(img: RgbaImage, quality = 0.92): Promise<number> {
  const c = document.createElement("canvas")
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext("2d")
  if (!ctx) throw new Error("2D canvas unavailable")
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(Math.round(b.size / 1024)) : reject(new Error("encode failed"))),
      "image/jpeg",
      quality,
    ),
  )
}

/** Decode a user file into an EXIF-corrected, size-capped RGBA source. */
export async function fileToSource(file: File | Blob, maxSide = 1600): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  const c = document.createElement("canvas")
  c.width = bitmap.width
  c.height = bitmap.height
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error("2D canvas unavailable")
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const id = ctx.getImageData(0, 0, c.width, c.height)
  const img = { data: id.data, width: id.width, height: id.height }
  const k = maxSide / Math.max(img.width, img.height)
  return k < 1 ? resizeBilinear(img, Math.round(img.width * k), Math.round(img.height * k)) : img
}

/** Deterministic demo portrait (drawn, no real face) for try-it-out flows. */
export function demoSource(w = 450, h = 600): RgbaImage {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("2D canvas unavailable")
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, "#cfd9e6")
  g.addColorStop(1, "#b9c6d6")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const cx = w / 2
  ctx.fillStyle = "#3a2e28" // hair
  ctx.beginPath()
  ctx.ellipse(cx, h * 0.27, w * 0.155, h * 0.095, 0, 0, 7)
  ctx.fill()
  ctx.fillRect(cx - w * 0.155, h * 0.25, w * 0.31, h * 0.075)
  ctx.fillStyle = "#f0c9a2" // face
  ctx.beginPath()
  ctx.ellipse(cx, h * 0.36, w * 0.145, h * 0.14, 0, 0, 7)
  ctx.fill()
  ctx.fillStyle = "#e5b58c" // neck
  ctx.fillRect(cx - w * 0.06, h * 0.47, w * 0.12, h * 0.1)
  ctx.fillStyle = "#4a3b32" // eyes
  ctx.beginPath()
  ctx.ellipse(cx - w * 0.07, h * 0.345, w * 0.016, w * 0.01, 0, 0, 7)
  ctx.ellipse(cx + w * 0.07, h * 0.345, w * 0.016, w * 0.01, 0, 0, 7)
  ctx.fill()
  ctx.strokeStyle = "#b98a68"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, h * 0.415, w * 0.045, 0.25 * Math.PI, 0.75 * Math.PI)
  ctx.stroke()
  ctx.fillStyle = "#a15c4a" // shirt (rust — clearly distinct from the bg for fallback mattes)
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.29, h * 0.75)
  ctx.quadraticCurveTo(cx - w * 0.27, h * 0.55, cx - w * 0.1, h * 0.535)
  ctx.lineTo(cx - w * 0.06, h * 0.535)
  ctx.lineTo(cx - w * 0.033, h * 0.585)
  ctx.lineTo(cx, h * 0.54)
  ctx.lineTo(cx + w * 0.033, h * 0.585)
  ctx.lineTo(cx + w * 0.06, h * 0.535)
  ctx.lineTo(cx + w * 0.1, h * 0.535)
  ctx.quadraticCurveTo(cx + w * 0.27, h * 0.55, cx + w * 0.29, h * 0.75)
  ctx.lineTo(cx + w * 0.29, h)
  ctx.lineTo(cx - w * 0.29, h)
  ctx.closePath()
  ctx.fill()
  const id = ctx.getImageData(0, 0, w, h)
  return { data: id.data, width: w, height: h }
}
