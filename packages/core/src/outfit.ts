import type { AlphaMat } from "./matte.ts"
import type { RgbaImage } from "./types.ts"
import { blankImage } from "./types.ts"

/**
 * Outfit patching (v3): replace the clothing region below the shoulder line
 * with a shaded template whose BODY hugs the matte's per-row outline (arms
 * included — a straight-sided garment leaves erased-arm gaps that show the
 * background), plus fabric shading, a neck-skin blend, collar contact shadow,
 * and ambient occlusion under the chin.
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
  /** Outline sampling stride in rows. Default: ~12 samples over the torso. */
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

/**
 * Build the outfit template anchored on the silhouette: the garment body
 * follows the per-row torso outline (arms included), the collar opens around
 * the estimated neck width, and shading layers give the fabric volume.
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
  const rise = m.headH * 0.13 // shoulders rise toward the neck
  const topY = m.shoulderY - m.headH * 0.1
  const botY = Math.min(height, m.bbox.y1 + 60)
  const neckY = topY + m.headH * 0.06

  const { bodyPath, bodyTopY } = bodyWrap(m, cx, nx, rise, topY, botY)

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
      cy: bodyTopY + nx * 0.2,
      r: nx * 1.9,
      stops: [
        [0, "rgba(0,0,0,0.30)"],
        [0.65, "rgba(0,0,0,0.10)"],
        [1, "rgba(0,0,0,0)"],
      ],
    },
    path: [e(cx, bodyTopY + nx * 0.2, nx * 1.9, nx * 0.8), close()],
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
  const sheen = (stops: [number, string][]): OutfitShape => ({
    // vertical light-on-top / dark-at-bottom volume overlay on the body
    paint: { kind: "linear", dir: "v", stops },
    path: bodyPath,
  })

  if (id === "suit") {
    const collarY = bodyTopY
    const vDepth = Math.max(shWOf(m) * 0.5, nx * 1.6)
    return [
      {
        // jacket body: cylinder shading — dark edges, lighter chest
        paint: {
          kind: "linear",
          dir: "h",
          stops: [
            [0, "#223049"],
            [0.28, "#2f4368"],
            [0.5, "#38527e"],
            [0.72, "#2f4368"],
            [1, "#1c293f"],
          ],
        },
        path: bodyPath,
      },
      sheen([
        [0, "rgba(255,255,255,0.14)"],
        [0.45, "rgba(255,255,255,0)"],
        [1, "rgba(0,0,0,0.24)"],
      ]),
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
        paint: { kind: "solid", color: "#7e2a30" },
        path: tiePath(cx, collarY + 1, nx, vDepth, botY, 1),
      },
      {
        paint: { kind: "solid", color: "#a0454c" },
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
    const collarY = bodyTopY
    return [
      {
        paint: {
          kind: "linear",
          dir: "h",
          stops: [
            [0, "#28374a"],
            [0.3, "#3f5470"],
            [0.5, "#47607f"],
            [0.7, "#3f5470"],
            [1, "#222e3d"],
          ],
        },
        path: bodyPath,
      },
      sheen([
        [0, "rgba(255,255,255,0.14)"],
        [0.45, "rgba(255,255,255,0)"],
        [1, "rgba(0,0,0,0.26)"],
      ]),
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
          q(cx, collarY + shWOf(m) * 0.34, cx + nx * 1.25, collarY + 2),
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
          q(cx, collarY + shWOf(m) * 0.16, cx + nx * 1.25, collarY + 2),
          ln(cx + nx * 1.25, collarY + 10),
          q(cx, collarY + shWOf(m) * 0.16 + 10, cx - nx * 1.25, collarY + 10),
          close(),
        ],
      },
      neckBlend,
      collarShadow,
      chinShadow,
    ]
  }
  // academic
  const collarY = bodyTopY
  return [
    {
      // gown: near-black with a horizontal sheen
      paint: {
        kind: "linear",
        dir: "h",
        stops: [
          [0, "#1a1d24"],
          [0.35, "#2c303c"],
          [0.5, "#333848"],
          [0.65, "#2c303c"],
          [1, "#15181e"],
        ],
      },
      path: gownPath(m, cx, nx, rise, topY, botY),
    },
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
      path: hoodPath(m, cx, nx, rise, topY),
    },
    neckBlend,
    collarShadow,
    chinShadow,
  ]
}

function shWOf(m: SilhouetteMetrics): number {
  return Math.max(m.shoulderRX - m.shoulderLX, m.headW * 1.6)
}

/**
 * Torso-hugging garment body: walk the sampled outline down the left side,
 * across the bottom, and up the right side, then close over the shoulders and
 * collar notch. A straight-sided fallback covers degenerate (outline-less)
 * mattes.
 */
function bodyWrap(
  m: SilhouetteMetrics,
  cx: number,
  nx: number,
  rise: number,
  topY: number,
  botY: number,
): { bodyPath: PathCommand[]; bodyTopY: number } {
  const o = m.outline
  if (!o) {
    const shL = Math.min(m.shoulderLX, cx - m.headW * 0.8)
    const shR = Math.max(m.shoulderRX, cx + m.headW * 0.8)
    const collarY = topY + shWOf(m) * 0.14
    return {
      bodyTopY: collarY,
      bodyPath: [
        mv(shL, m.shoulderY + shWOf(m) * 0.06),
        q(shL + shWOf(m) * 0.02, topY, cx - nx * 1.9, collarY - rise * 0.3),
        ln(cx - nx, collarY),
        ln(cx + nx, collarY),
        q(cx + nx * 1.9, collarY - rise * 0.3, shR - shWOf(m) * 0.02, topY),
        ln(shR, m.shoulderY + shWOf(m) * 0.06),
        ln(shR, botY),
        ln(shL, botY),
        close(),
      ],
    }
  }
  const collarY = topY + m.headH * 0.08
  const path: PathCommand[] = []
  // left shoulder → down the left outline
  path.push(mv(o.left[0]!, o.ys[0]!))
  for (let i = 1; i < o.ys.length; i++) path.push(ln(o.left[i]!, Math.min(o.ys[i]!, botY)))
  path.push(ln(o.left[o.left.length - 1]!, botY))
  // across the bottom, up the right outline
  path.push(ln(o.right[o.right.length - 1]!, botY))
  for (let i = o.ys.length - 1; i >= 0; i--) path.push(ln(o.right[i]!, Math.min(o.ys[i]!, botY)))
  // over the right shoulder into the collar notch, across, back out left
  path.push(q(cx + nx * 2.0, collarY - rise * 0.35, cx + nx, collarY))
  path.push(ln(cx - nx, collarY))
  path.push(q(cx - nx * 1.7, collarY - rise * 0.3, o.left[0]!, o.ys[0]!))
  path.push(close())
  return { bodyPath: path, bodyTopY: collarY }
}

/** Academic gown flares wider than the body outline. */
function gownPath(
  m: SilhouetteMetrics,
  cx: number,
  nx: number,
  rise: number,
  topY: number,
  height: number,
): PathCommand[] {
  const o = m.outline
  const flare = (m.bbox.x1 - m.bbox.x0) * 0.08
  const grow = (x: number, edge: 0 | 1) => (edge === 0 ? x - flare : x + flare)
  if (!o) {
    const aw = shWOf(m) * 1.16
    const bot = m.bbox.y1
    return [
      mv(cx - aw / 2, m.shoulderY + shWOf(m) * 0.12),
      q(cx - aw * 0.52, topY, cx - aw * 0.3, topY - rise * 0.2),
      q(cx, topY - rise * 0.55, cx + aw * 0.3, topY - rise * 0.2),
      q(cx + aw * 0.52, topY, cx + aw / 2, m.shoulderY + shWOf(m) * 0.12),
      ln(cx + aw / 2, bot),
      ln(cx - aw / 2, bot),
      close(),
    ]
  }
  const botY = Math.min(o.ys[o.ys.length - 1]! + 40, height)
  const path: PathCommand[] = [mv(grow(o.left[0]!, 0), o.ys[0]!)]
  for (let i = 1; i < o.ys.length; i++) path.push(ln(grow(o.left[i]!, 0), o.ys[i]!))
  path.push(ln(grow(o.left[o.left.length - 1]!, 0), botY))
  path.push(ln(grow(o.right[o.right.length - 1]!, 1), botY))
  for (let i = o.ys.length - 1; i >= 0; i--) path.push(ln(grow(o.right[i]!, 1), o.ys[i]!))
  path.push(q(cx + nx * 2.2, o.ys[0]! - rise, cx + nx, o.ys[0]! + 4))
  path.push(ln(cx - nx, o.ys[0]! + 4))
  path.push(q(cx - nx * 1.9, o.ys[0]! - rise, grow(o.left[0]!, 0), o.ys[0]!))
  path.push(close())
  return path
}

function hoodPath(
  m: SilhouetteMetrics,
  cx: number,
  nx: number,
  rise: number,
  topY: number,
): PathCommand[] {
  const aw = shWOf(m) * 1.16
  const collarY = topY + m.headH * 0.08
  return [
    mv(cx - aw * 0.46, m.shoulderY + shWOf(m) * 0.08),
    q(cx - aw * 0.42, topY, cx - aw * 0.26, topY - rise * 0.3),
    q(cx, topY - rise * 0.5, cx + aw * 0.12, collarY),
    ln(cx + aw * 0.36, collarY + shWOf(m) * 0.14),
    q(cx + aw * 0.32, collarY + shWOf(m) * 0.42, cx + aw * 0.22, collarY + shWOf(m) * 0.58),
    ln(cx + aw * 0.08, collarY + shWOf(m) * 0.6),
    q(cx + aw * 0.1, collarY + shWOf(m) * 0.3, cx - aw * 0.3, collarY + shWOf(m) * 0.2),
    close(),
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
