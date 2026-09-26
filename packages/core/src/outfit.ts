import type { AlphaMat } from "./matte.ts"
import type { RgbaImage } from "./types.ts"
import { blankImage } from "./types.ts"

/**
 * Outfit patching (v4): RESTYLE the person's own clothing instead of painting
 * a vector garment over it. The original pixels below the seam keep their
 * wrinkles, folds, and lighting (high-frequency luma detail is transferred
 * onto the target fabric gradient), so the result moves and shades with the
 * real body — the flat "pasted-on" look of a fully synthetic garment is gone.
 * Vector accents (collar, lapels, tie, hood) ride on top for garment identity.
 *
 * Shape generation stays pure data (path commands + paint specs) so the
 * platform layer rasterizes it however it wants; pixel blending stays here so
 * every backend gets identical seams. The M3 commercial tier swaps this for
 * AI segmentation/diffusion — the SilhouetteMetrics + merge contract is
 * designed to survive that.
 */

/** Outfit template ids understood by buildOutfitShapes. */
export type OutfitId = "suit" | "career" | "academic"

/** Per-row silhouette extents below the shoulders (sampled, row-major). */
export interface SilhouetteOutline {
  ys: number[]
  left: number[]
  right: number[]
}

/** Silhouette anchors for outfit placement (pixel units, source grid). */
export interface SilhouetteMetrics {
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** Median row width over the top of the head (hair included). */
  headW: number
  /** First row where the head narrows to neck width, when detectable. */
  chinY: number | null
  /** First row where the silhouette flares out to shoulder width. */
  shoulderY: number
  /** Foreground extents on the shoulder row — where the garment ends. */
  shoulderLX: number
  shoulderRX: number
  /** Crown→chin distance (falls back to crown→shoulder). */
  headH: number
  /** Sampled outline from just above the shoulders down; null on degenerate mattes. */
  outline: SilhouetteOutline | null
}

export interface SilhouetteOptions {
  /** Row width threshold (× head width) marking the chin/neck narrowing. Default 0.5. */
  neckRatio?: number
  /** Row width threshold (× head width) marking the shoulder flare. Default 1.5. */
  shoulderRatio?: number
  /** Outline sampling stride in rows. Default: ~14 samples over the torso. */
  outlineStep?: number
}

const WIDTH_EPSILON = 0.01 // rows narrower than this fraction of width are noise

/**
 * Derive head/shoulder anchors from a portrait alpha matte by scanning row
 * widths: the head is the wide block on top, the neck narrows, the shoulders
 * flare back out. Works on any matte source (MediaPipe, MODNet, BiRefNet…) and
 * is fully deterministic — the same input always yields the same seam.
 */
export function silhouetteMetrics(
  alpha: AlphaMat,
  width: number,
  height: number,
  opts: SilhouetteOptions = {},
): SilhouetteMetrics {
  const neckRatio = opts.neckRatio ?? 0.5
  const shoulderRatio = opts.shoulderRatio ?? 1.5

  let x0 = width
  let x1 = 0
  let y0 = height
  let y1 = 0
  const widths = new Float32Array(height)
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! > 128) n++
    }
    widths[y] = n
    if (n > width * WIDTH_EPSILON) {
      const lx = firstForegroundRow(alpha, width, y)
      const rx = lastForegroundRow(alpha, width, y)
      if (lx < x0) x0 = lx
      if (rx > x1) x1 = rx
      if (y < y0) y0 = y
      y1 = y
    }
  }
  if (x1 <= x0 || y1 <= y0) {
    // Degenerate matte: fall back to a centered box so callers still get sane anchors
    x0 = Math.round(width * 0.3)
    x1 = Math.round(width * 0.7)
    y0 = Math.round(height * 0.1)
    y1 = Math.round(height * 0.95)
  }

  const bh = y1 - y0
  const headBand: number[] = []
  for (let y = y0; y < Math.max(y0 + 8, y0 + Math.round(bh * 0.16)); y++) headBand.push(widths[y]!)
  const headW = median(headBand) || (x1 - x0) * 0.5

  let chinY: number | null = null
  for (let y = y0 + Math.round(bh * 0.18); y < y1; y++) {
    if (widths[y]! < headW * neckRatio) {
      chinY = y
      break
    }
  }
  let shoulderY = y0 + Math.round(bh * 0.32)
  for (let y = y0 + Math.round(bh * 0.14); y < y1; y++) {
    if (widths[y]! >= headW * shoulderRatio) {
      shoulderY = y
      break
    }
  }
  const shoulderLX = firstForegroundRow(alpha, width, shoulderY)
  const shoulderRX = lastForegroundRow(alpha, width, shoulderY)

  // torso outline: sampled extents from just above the shoulders to the feet
  let outline: SilhouetteOutline | null = null
  if (y1 - shoulderY > 12) {
    const step = opts.outlineStep ?? Math.max(6, Math.round((y1 - shoulderY) / 14))
    const ys: number[] = []
    const left: number[] = []
    const right: number[] = []
    for (let y = Math.max(0, shoulderY - 6); y <= y1; y += step) {
      ys.push(y)
      left.push(firstForegroundRow(alpha, width, y))
      right.push(lastForegroundRow(alpha, width, y))
    }
    if (ys.length >= 2) outline = { ys, left, right }
  }

  return {
    bbox: { x0, y0, x1, y1 },
    headW,
    chinY,
    shoulderY,
    shoulderLX,
    shoulderRX,
    headH: (chinY ?? shoulderY) - y0,
    outline,
  }
}

function firstForegroundRow(alpha: AlphaMat, width: number, y: number): number {
  const base = y * width
  for (let x = 0; x < width; x++) if (alpha[base + x]! > 128) return x
  return width
}

function lastForegroundRow(alpha: AlphaMat, width: number, y: number): number {
  const base = y * width
  for (let x = width - 1; x >= 0; x--) if (alpha[base + x]! > 128) return x
  return -1
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const m = sorted.length >> 1
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2
}

/** Vector path command; "Z" closes the subpath, "E" appends an ellipse. */
export type PathCommand =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "Q"; cx: number; cy: number; x: number; y: number }
  | { op: "E"; cx: number; cy: number; rx: number; ry: number }
  | { op: "Z" }

/**
 * Paint spec. "linear" runs over the shape's own bounding box (relative
 * coords, so templates don't need absolute gradients); "radial" uses absolute
 * pixel coordinates for things anchored at a point (shadows, glints).
 */
export type Paint =
  | { kind: "solid"; color: string }
  | { kind: "linear"; dir: "v" | "h"; stops: [number, string][] }
  | { kind: "radial"; cx: number; cy: number; r: number; stops: [number, string][] }

/** One painted polygon of an outfit template. */
export interface OutfitShape {
  paint: Paint
  path: PathCommand[]
}

export interface OutfitStyleOptions {
  /** Skin tone (RGB) for the collar blend; measured from the photo's face. Default mid-tone. */
  skin?: [number, number, number]
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

/** Fabric base colors of each template (torso top → bottom). */
export interface GarmentBase {
  top: [number, number, number]
  bottom: [number, number, number]
}

export function garmentBase(id: OutfitId): GarmentBase {
  if (id === "suit") return { top: [52, 72, 110], bottom: [34, 49, 78] }
  if (id === "career") return { top: [66, 90, 128], bottom: [44, 62, 92] }
  return { top: [50, 54, 66], bottom: [28, 31, 40] } // academic
}

export interface RestyleOptions {
  base: GarmentBase
  seamY: number
  feather: number
  outline: SilhouetteOutline | null
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** Horizontal shading agrees with the brighter side of the face. */
  lightFromLeft: boolean
}

/**
 * Restyle the garment region of the person: recolor everything below the seam
 * onto the template's fabric gradient while TRANSFERRING the original luma
 * detail (wrinkles, folds, body shading) onto it. Returns a full-canvas layer
 * (opaque below the seam, transparent above); mergeOutfitLayer handles the
 * seam blend and silhouette clipping.
 */
export function restyleGarment(person: RgbaImage, alpha: AlphaMat, o: RestyleOptions): RgbaImage {
  const detail = computeDetailMap(person, o.seamY, o.bbox)
  const out = blankImage(person.width, person.height)
  const spanY = Math.max(1, o.bbox.y1 - o.seamY)
  let oi = 0 // outline sample cursor — rows are visited in order
  for (let y = Math.max(0, Math.floor(o.seamY - o.feather)); y < person.height; y++) {
    if (o.outline) {
      while (oi + 1 < o.outline.ys.length && o.outline.ys[oi + 1]! <= y) oi++
    }
    const lx = o.outline ? o.outline.left[oi]! : o.bbox.x0
    const rx = o.outline ? o.outline.right[oi]! : o.bbox.x1
    const rowHalf = Math.max(1, (rx - lx) / 2)
    const cx = (lx + rx) / 2
    const t = clamp01((y - o.seamY) / spanY)
    for (let x = 0; x < person.width; x++) {
      const i = y * person.width + x
      if (alpha[i]! < 24) continue
      const xRel = (x - cx) / rowHalf
      const dirX = o.lightFromLeft ? xRel : -xRel
      const shade = 1 - 0.28 * Math.abs(xRel) ** 1.6 - 0.08 * dirX
      const p = i * 4
      for (let c = 0; c < 3; c++) {
        const base = o.base.top[c]! + (o.base.bottom[c]! - o.base.top[c]!) * t
        out.data[p + c] = base * shade * detail[i]!
      }
      out.data[p + 3] = 255
    }
  }
  return out
}

export interface DetailMapOptions {
  /** Divisor of the torso span for the low-pass radius. Smaller = more mid-scale folds kept as detail. Default 48. */
  radiusDivisor?: number
  /** Detail ratio clamp. Default [0.5, 1.7]. */
  range?: [number, number]
}

/**
 * High-frequency luma ratio map of the garment region (luma / blurred luma,
 * contrast-boosted ×1.25): the person's real wrinkles and folds, extracted
 * once so both the restyled fabric AND the vector accents can inherit it.
 */
export function computeDetailMap(
  person: RgbaImage,
  seamY: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  opts: DetailMapOptions = {},
): Float32Array {
  const { width: w, height: h } = person
  const divisor = opts.radiusDivisor ?? 48
  const [lo, hi] = opts.range ?? [0.5, 1.7]
  const luma = new Float32Array(w * h)
  for (let i = 0; i < luma.length; i++) {
    const p = i * 4
    luma[i] = 0.299 * person.data[p]! + 0.587 * person.data[p + 1]! + 0.114 * person.data[p + 2]!
  }
  const radius = Math.max(6, Math.round((bbox.y1 - seamY) / divisor))
  const smooth = boxBlur(luma, w, h, radius)

  const detail = new Float32Array(w * h).fill(1)
  for (let i = 0; i < detail.length; i++) {
    const s = smooth[i]!
    if (s <= 1) continue
    const ratio = clampRange(luma[i]! / s, lo, hi)
    detail[i] = 1 + (ratio - 1) * 1.25 // contrast boost — dark fabrics swallow detail
  }
  return detail
}

/**
 * Multiply a layer's RGB by the detail map (partial strength for accents so
 * vector pieces inherit the photo's fabric grain without doubling).
 */
export function applyDetailMap(layer: RgbaImage, detail: Float32Array, strength = 1): void {
  const d = layer.data
  for (let i = 0; i < detail.length; i++) {
    if (d[i * 4 + 3]! === 0) continue
    const k = 1 + (detail[i]! - 1) * strength
    const p = i * 4
    d[p] *= k
    d[p + 1] *= k
    d[p + 2] *= k
  }
}

/**
 * Overlay accent shapes (collar / lapels / tie / shadows) on the MERGED
 * portrait, clipped to the merged silhouette. Drawing accents after the seam
 * merge — instead of fading them through it — gives the collar a crisp
 * garment edge where it overlaps the neck base, like a real collar does; no
 * 80px skin-to-fabric smear.
 */
export function overlayAccents(
  base: RgbaImage,
  baseAlpha: AlphaMat,
  accents: RgbaImage,
): RgbaImage {
  const { width: w, height: h } = base
  if (accents.width !== w || accents.height !== h) {
    throw new Error("accent layer dimensions do not match the portrait")
  }
  const out = { data: new Uint8ClampedArray(base.data), width: w, height: h }
  for (let i = 0; i < baseAlpha.length; i++) {
    const aA = (accents.data[i * 4 + 3]! / 255) * (baseAlpha[i]! / 255)
    if (aA <= 0) continue
    const p = i * 4
    for (let c = 0; c < 3; c++) {
      out.data[p + c] = base.data[p + c]! * (1 - aA) + accents.data[p + c]! * aA
    }
    out.data[p + 3] = 255
  }
  return out
}

/** Separable box blur with running sums (edge-clamped), O(pixels). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const win = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))]!
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win
      sum += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
  return out
}

/**
 * Accent shapes that give the restyled garment its identity: collar opening,
 * lapels, tie / placket / hood, plus the finishing shadows. The fabric body
 * itself comes from restyleGarment — no painted body polygon anymore.
 */
export function buildOutfitShapes(
  id: OutfitId,
  m: SilhouetteMetrics,
  height: number,
  opts: OutfitStyleOptions = {},
): OutfitShape[] {
  const skin = opts.skin ?? [229, 181, 140]
  const cx = (m.bbox.x0 + m.bbox.x1) / 2
  const nx = m.headW * 0.32 // half collar opening — breathes around the neck
  const shW = Math.max(m.shoulderRX - m.shoulderLX, m.headW * 1.6)
  const topY = m.shoulderY - m.headH * 0.1
  const collarY = topY + m.headH * 0.08
  const botY = Math.min(height, m.bbox.y1 + 60)
  const neckY = topY + m.headH * 0.06

  // shared finishing layers ----------------------------------------------
  const neckBlend: OutfitShape = {
    // soft skin glow at the collar opening — kills the pasted-on seam
    paint: {
      kind: "radial",
      cx,
      cy: neckY,
      r: nx * 1.7,
      stops: [
        [0, rgba(skin, 0.85)],
        [0.6, rgba(skin, 0.45)],
        [1, rgba(skin, 0)],
      ],
    },
    path: [e(cx, neckY + nx * 0.5, nx * 1.7, nx * 1.5), close()],
  }
  const collarShadow: OutfitShape = {
    // contact shadow where the collar meets the neck sides
    paint: {
      kind: "radial",
      cx,
      cy: collarY + nx * 0.2,
      r: nx * 1.9,
      stops: [
        [0, "rgba(0,0,0,0.30)"],
        [0.65, "rgba(0,0,0,0.12)"],
        [1, "rgba(0,0,0,0)"],
      ],
    },
    path: [e(cx, collarY + nx * 0.2, nx * 1.9, nx * 0.8), close()],
  }
  const chinShadow: OutfitShape = {
    // ambient occlusion under the chin onto the garment
    paint: {
      kind: "radial",
      cx,
      cy: neckY + m.headH * 0.05,
      r: nx * 2.6,
      stops: [
        [0, "rgba(0,0,0,0.30)"],
        [0.6, "rgba(0,0,0,0.12)"],
        [1, "rgba(0,0,0,0)"],
      ],
    },
    path: [e(cx, neckY + m.headH * 0.05, nx * 2.6, nx * 1.6), close()],
  }

  if (id === "suit") {
    const vDepth = Math.max(shW * 0.5, nx * 1.6)
    return [
      {
        // soft white halo around the shirt V — melts its edge into the jacket
        paint: {
          kind: "radial",
          cx,
          cy: collarY + vDepth * 0.3,
          r: nx * 1.9,
          stops: [
            [0, "rgba(240,244,249,0.55)"],
            [0.6, "rgba(240,244,249,0.28)"],
            [1, "rgba(240,244,249,0)"],
          ],
        },
        path: [e(cx, collarY + vDepth * 0.3, nx * 1.9, vDepth * 0.9), close()],
      },
      {
        // shirt V: near-white with a downward dim
        paint: {
          kind: "linear",
          dir: "v",
          stops: [
            [0, "#f7f9fc"],
            [1, "#dbe1e9"],
          ],
        },
        path: [
          mv(cx - nx, collarY),
          ln(cx, collarY + vDepth),
          ln(cx + nx, collarY),
          ln(cx + nx * 0.64, collarY),
          ln(cx, collarY + vDepth * 0.84),
          ln(cx - nx * 0.64, collarY),
          close(),
        ],
      },
      {
        // tie body: gentle vertical variation so its lower half blends in
        paint: {
          kind: "linear",
          dir: "v",
          stops: [
            [0, "#7e2a30"],
            [0.6, "#8a3138"],
            [1, "#6e262b"],
          ],
        },
        path: tiePath(cx, collarY + 1, nx, vDepth, botY, 1),
      },
      {
        // tie highlight: fades out downward instead of ending in a flat band
        paint: {
          kind: "linear",
          dir: "v",
          stops: [
            [0, "rgba(160,69,76,0.9)"],
            [1, "rgba(126,42,48,0)"],
          ],
        },
        path: tiePath(cx - nx * 0.08, collarY + 1, nx * 0.58, vDepth, botY, 0.7),
      },
      lapel(cx - nx, collarY, m.shoulderLX, m.shoulderY, vDepth),
      lapel(cx + nx, collarY, m.shoulderRX, m.shoulderY, vDepth, true),
      neckBlend,
      collarShadow,
      chinShadow,
    ]
  }
  if (id === "career") {
    return [
      {
        // white inner panel, wide V
        paint: {
          kind: "linear",
          dir: "v",
          stops: [
            [0, "#f4f6f9"],
            [1, "#dee4ec"],
          ],
        },
        path: [
          mv(cx - nx * 1.25, collarY + 2),
          q(cx, collarY + shW * 0.34, cx + nx * 1.25, collarY + 2),
          ln(cx + nx * 1.25, botY),
          ln(cx - nx * 1.25, botY),
          close(),
        ],
      },
      {
        // collar band hint
        paint: { kind: "solid", color: "#55677e" },
        path: [
          mv(cx - nx * 1.25, collarY + 2),
          q(cx, collarY + shW * 0.16, cx + nx * 1.25, collarY + 2),
          ln(cx + nx * 1.25, collarY + 10),
          q(cx, collarY + shW * 0.16 + 10, cx - nx * 1.25, collarY + 10),
          close(),
        ],
      },
      neckBlend,
      collarShadow,
      chinShadow,
    ]
  }
  // academic
  const rise = m.headH * 0.13
  return [
    {
      paint: {
        kind: "linear",
        dir: "v",
        stops: [
          [0, "#f4f6f9"],
          [1, "#dde3eb"],
        ],
      },
      path: [
        mv(cx - nx * 1.3, collarY),
        ln(cx + nx * 1.3, collarY),
        ln(cx + nx * 1.3, botY),
        ln(cx - nx * 1.3, botY),
        close(),
      ],
    },
    {
      // velvet hood: deep red with a fold highlight
      paint: {
        kind: "linear",
        dir: "v",
        stops: [
          [0, "#8c2f34"],
          [0.5, "#a23c41"],
          [1, "#6b2125"],
        ],
      },
      path: [
        mv(cx - shW * 0.46, m.shoulderY + shW * 0.08),
        q(cx - shW * 0.42, topY, cx - shW * 0.26, topY - rise * 0.3),
        q(cx, topY - rise * 0.5, cx + shW * 0.12, collarY),
        ln(cx + shW * 0.36, collarY + shW * 0.14),
        q(cx + shW * 0.32, collarY + shW * 0.42, cx + shW * 0.22, collarY + shW * 0.58),
        ln(cx + shW * 0.08, collarY + shW * 0.6),
        q(cx + shW * 0.1, collarY + shW * 0.3, cx - shW * 0.3, collarY + shW * 0.2),
        close(),
      ],
    },
    neckBlend,
    collarShadow,
    chinShadow,
  ]
}

// path builders keep the shape tables readable ---------------------------
const mv = (x: number, y: number): PathCommand => ({ op: "M", x, y })
const ln = (x: number, y: number): PathCommand => ({ op: "L", x, y })
const q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
  op: "Q",
  cx,
  cy,
  x,
  y,
})
const e = (cx: number, cy: number, rx: number, ry: number): PathCommand => ({
  op: "E",
  cx,
  cy,
  rx,
  ry,
})
const close = (): PathCommand => ({ op: "Z" })

function tiePath(
  cx: number,
  topY: number,
  nx: number,
  vDepth: number,
  botY: number,
  widthFactor: number,
): PathCommand[] {
  const tw = nx * 0.38 * widthFactor
  const knotY = topY + nx * 0.06
  return [
    mv(cx - tw, knotY),
    ln(cx + tw, knotY),
    ln(cx + tw * 0.75, topY + vDepth * 0.72),
    ln(cx + tw * 1.2, botY),
    ln(cx - tw * 1.2, botY),
    ln(cx - tw * 0.75, topY + vDepth * 0.72),
    close(),
  ]
}

function lapel(
  collarX: number,
  collarY: number,
  shoulderX: number,
  shoulderY: number,
  vDepth: number,
  mirror = false,
): OutfitShape {
  const dir = mirror ? -1 : 1
  const span = Math.abs(shoulderX - collarX) * 0.85
  const x = (v: number) => collarX + dir * v
  return {
    paint: {
      kind: "linear",
      dir: "v",
      stops: [
        [0, "#25344e"],
        [1, "#182536"],
      ],
    },
    path: [
      mv(x(0), collarY),
      ln(x(span), shoulderY - (shoulderY - collarY) * 0.1),
      ln(x(span * 0.45), collarY + vDepth * 0.75),
      ln(x(-span * 0.1), collarY + vDepth * 0.4),
      close(),
    ],
  }
}

export interface OutfitBlend {
  /** Person above the seam over the outfit below it (straight alpha). */
  portrait: RgbaImage
  /** Combined alpha (person ∪ outfit, seam-feathered). */
  alpha: AlphaMat
}

/**
 * Merge the outfit layer under the person: the original clothing region is
 * replaced below the seam (feathered), the outfit patch is clipped to the
 * silhouette below the seam, and the person's head/shoulders are composited
 * over the patch so the neck line stays natural.
 */
export function mergeOutfitLayer(
  person: RgbaImage,
  alpha: AlphaMat,
  outfit: RgbaImage,
  seamY: number,
  feather: number,
): OutfitBlend {
  const { width: w, height: h } = person
  if (outfit.width !== w || outfit.height !== h) {
    throw new Error("outfit layer dimensions do not match the portrait")
  }
  if (alpha.length !== w * h) throw new Error("alpha matte dimensions do not match the portrait")

  const out = blankImage(w, h)
  const outAlpha = new Uint8ClampedArray(w * h)
  const f = Math.max(1, feather)
  for (let y = 0; y < h; y++) {
    const keepPerson = clamp01((seamY + f - y) / (2 * f)) // 1 above the seam → 0 below
    const showOutfit = clamp01((y - (seamY - f)) / (2 * f)) // 0 above the seam → 1 below
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p4 = i * 4
      const pa = (alpha[i]! / 255) * keepPerson
      const oa = (outfit.data[p4 + 3]! / 255) * showOutfit * (alpha[i]! / 255)
      const outA = pa + oa * (1 - pa)
      outAlpha[i] = outA * 255
      if (outA <= 1e-6) continue
      for (let c = 0; c < 3; c++) {
        out.data[p4 + c] = (person.data[p4 + c]! * pa + outfit.data[p4 + c]! * oa * (1 - pa)) / outA
      }
      out.data[p4 + 3] = 255
    }
  }
  return { portrait: out, alpha: outAlpha }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
