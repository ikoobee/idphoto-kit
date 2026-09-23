import type { AlphaMat } from "./matte.ts"
import type { RgbaImage } from "./types.ts"
import { blankImage } from "./types.ts"

/**
 * Outfit patching (v1): replace the clothing region below the shoulder line
 * with a parametric template (suit / career / academic), anchored on silhouette
 * metrics derived from the matte. Shape generation is pure data (path commands)
 * so the platform layer can rasterize it however it wants; pixel blending stays
 * here so every backend gets identical seams.
 *
 * The M3 commercial tier upgrades this to AI segmentation/diffusion — the
 * SilhouetteMetrics + merge contract is designed to survive that swap.
 */

/** Outfit template ids understood by buildOutfitShapes. */
export type OutfitId = "suit" | "career" | "academic"

/** Silhouette anchors for outfit placement (pixel units, source grid). */
export interface SilhouetteMetrics {
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** Median row width over the top of the head (hair included). */
  headW: number
  /** First row where the head narrows to neck width, when detectable. */
  chinY: number | null
  /** First row where the silhouette flares out to shoulder width. */
  shoulderY: number
  /** Crown→chin distance (falls back to crown→shoulder). */
  headH: number
}

export interface SilhouetteOptions {
  /** Row width threshold (× head width) marking the chin/neck narrowing. Default 0.5. */
  neckRatio?: number
  /** Row width threshold (× head width) marking the shoulder flare. Default 1.5. */
  shoulderRatio?: number
}

const WIDTH_EPSILON = 0.01 // rows narrower than this fraction of width are noise

/**
 * Derive head/shoulder anchors from a portrait alpha matte by scanning row
 * widths: the head is the wide block on top, the neck narrows, the shoulders
 * flare back out. Works on any matte source (MODNet, BiRefNet, …) and is fully
 * deterministic — the same input always yields the same seam.
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

  return {
    bbox: { x0, y0, x1, y1 },
    headW,
    chinY,
    shoulderY,
    headH: (chinY ?? shoulderY) - y0,
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

/** Vector path command; "Z" closes the subpath. Coordinates are in pixels. */
export type PathCommand =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "Q"; cx: number; cy: number; x: number; y: number }
  | { op: "Z" }

/** One filled polygon of an outfit template. */
export interface OutfitShape {
  fill: string // #RRGGBB
  path: PathCommand[]
}

/**
 * Build the outfit template shapes anchored on the silhouette: shoulders sit
 * on the flare row, the collar opens around the estimated neck width, and the
 * body extends past the matte bbox so no original clothing peeks out below.
 */
export function buildOutfitShapes(
  id: OutfitId,
  metrics: SilhouetteMetrics,
  height: number,
): OutfitShape[] {
  const cx = (metrics.bbox.x0 + metrics.bbox.x1) / 2
  const shW = Math.max(metrics.headW * 2.15, (metrics.bbox.x1 - metrics.bbox.x0) * 0.94)
  const topY = metrics.shoulderY - metrics.headH * 0.14
  const botY = Math.min(height, metrics.bbox.y1 + 60)
  const nx = metrics.headW * 0.3

  if (id === "suit") {
    const tw = nx * 0.34
    return [
      {
        fill: "#2c3e5d",
        path: [
          m(cx - shW / 2, topY + shW * 0.1),
          q(cx - shW * 0.52, topY, cx - shW * 0.34, topY - shW * 0.06),
          q(cx - nx * 1.6, topY + shW * 0.02, cx - nx, topY + shW * 0.16),
          m2(cx + nx, topY + shW * 0.16),
          q(cx + nx * 1.6, topY + shW * 0.02, cx + shW * 0.34, topY - shW * 0.06),
          q(cx + shW * 0.52, topY, cx + shW / 2, topY + shW * 0.1),
          m2(cx + shW / 2, botY),
          m2(cx - shW / 2, botY),
          close(),
        ],
      },
      {
        fill: "#f4f6f9",
        path: [
          m(cx - nx, topY + shW * 0.16),
          m2(cx, topY + shW * 0.62),
          m2(cx + nx, topY + shW * 0.16),
          m2(cx + nx * 0.6, topY + shW * 0.16),
          m2(cx, topY + shW * 0.5),
          m2(cx - nx * 0.6, topY + shW * 0.16),
          close(),
        ],
      },
      {
        fill: "#8c2f34",
        path: [
          m(cx - tw, topY + shW * 0.18),
          m2(cx + tw, topY + shW * 0.18),
          m2(cx + tw * 0.7, topY + shW * 0.55),
          m2(cx + tw * 1.1, botY),
          m2(cx - tw * 1.1, botY),
          m2(cx - tw * 0.7, topY + shW * 0.55),
          close(),
        ],
      },
      // lapels: thin dark quads flanking the shirt V
      {
        fill: "#1e2c44",
        path: [
          m(cx - nx, topY + shW * 0.16),
          m2(cx - nx * 1.7, topY + shW * 0.3),
          m2(cx - nx * 1.15, topY + shW * 0.62),
          m2(cx - nx * 0.72, topY + shW * 0.4),
          close(),
        ],
      },
      {
        fill: "#1e2c44",
        path: [
          m(cx + nx, topY + shW * 0.16),
          m2(cx + nx * 1.7, topY + shW * 0.3),
          m2(cx + nx * 1.15, topY + shW * 0.62),
          m2(cx + nx * 0.72, topY + shW * 0.4),
          close(),
        ],
      },
    ]
  }
  if (id === "career") {
    return [
      {
        fill: "#37475c",
        path: [
          m(cx - shW / 2, topY + shW * 0.16),
          q(cx - shW * 0.55, topY + shW * 0.02, cx - shW * 0.3, topY),
          q(cx, topY - shW * 0.04, cx + shW * 0.3, topY),
          q(cx + shW * 0.55, topY + shW * 0.02, cx + shW / 2, topY + shW * 0.16),
          m2(cx + shW / 2, botY),
          m2(cx - shW / 2, botY),
          close(),
        ],
      },
      {
        fill: "#eef1f5",
        path: [
          m(cx - nx * 1.15, topY + shW * 0.1),
          q(cx, topY + shW * 0.52, cx + nx * 1.15, topY + shW * 0.1),
          m2(cx + nx * 1.15, botY),
          m2(cx - nx * 1.15, botY),
          close(),
        ],
      },
      {
        fill: "#c9a44e",
        path: [
          m(cx + nx * 1.6 - shW * 0.035, topY + shW * 0.34),
          m2(cx + nx * 1.6 + shW * 0.035, topY + shW * 0.34),
          m2(cx + nx * 1.6 + shW * 0.035, topY + shW * 0.34 + shW * 0.07),
          m2(cx + nx * 1.6 - shW * 0.035, topY + shW * 0.34 + shW * 0.07),
          close(),
        ],
      },
    ]
  }
  // academic
  const aw = shW * 1.16
  return [
    {
      fill: "#23262e",
      path: [
        m(cx - aw / 2, topY + shW * 0.2),
        q(cx - aw * 0.52, topY, cx - aw * 0.3, topY - shW * 0.03),
        q(cx, topY - shW * 0.07, cx + aw * 0.3, topY - shW * 0.03),
        q(cx + aw * 0.52, topY, cx + aw / 2, topY + shW * 0.2),
        m2(cx + aw / 2, botY),
        m2(cx - aw / 2, botY),
        close(),
      ],
    },
    {
      fill: "#f4f6f9",
      path: [
        m(cx - nx * 1.3, topY + shW * 0.06),
        m2(cx + nx * 1.3, topY + shW * 0.06),
        m2(cx + nx * 1.3, botY),
        m2(cx - nx * 1.3, botY),
        close(),
      ],
    },
    {
      fill: "#8c2f34",
      path: [
        m(cx - aw * 0.46, topY + shW * 0.1),
        q(cx - aw * 0.42, topY - shW * 0.02, cx - aw * 0.26, topY - shW * 0.05),
        q(cx, topY - shW * 0.02, cx + aw * 0.1, topY + shW * 0.02),
        m2(cx + aw * 0.34, topY + shW * 0.16),
        q(cx + aw * 0.3, topY + shW * 0.42, cx + aw * 0.2, topY + shW * 0.58),
        m2(cx + aw * 0.06, topY + shW * 0.6),
        q(cx + aw * 0.1, topY + shW * 0.3, cx - aw * 0.3, topY + shW * 0.22),
        close(),
      ],
    },
  ]
}

// tiny builders keep the shape tables readable
const m = (x: number, y: number): PathCommand => ({ op: "M", x, y })
const m2 = (x: number, y: number): PathCommand => ({ op: "L", x, y })
const q = (cx: number, cy: number, x: number, y: number): PathCommand => ({
  op: "Q",
  cx,
  cy,
  x,
  y,
})
const close = (): PathCommand => ({ op: "Z" })

export interface OutfitBlend {
  /** Person above the seam over the outfit below it (straight alpha). */
  portrait: RgbaImage
  /** Combined alpha (person ∪ outfit, seam-feathered). */
  alpha: AlphaMat
}

/**
 * Merge a rasterized outfit layer under the person: the original clothing is
 * erased below the seam (feathered), the outfit patch is clipped to the
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
