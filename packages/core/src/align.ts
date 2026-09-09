import {
  type CropTarget,
  DEFAULT_EYE_LINE_RATIO,
  DEFAULT_HEAD_HEIGHT_RATIO,
  type FaceLandmarks,
  rotateAround,
} from "./face.ts"
import { blankImage, type RgbaImage } from "./types.ts"

/** Non-fatal advisories surfaced by the UI check-list. */
export type CropWarningCode = "upscale" | "large-roll" | "content-clamped"

export interface CropWarning {
  code: CropWarningCode
  message: string
}

/** Computed geometry for placing the face onto the spec canvas. */
export interface CropPlan {
  width: number
  height: number
  /** Source→canvas scale factor (>1 means upsampling a low-res source). */
  scale: number
  /** Counter-roll applied to level the eye line, degrees. */
  rollDegrees: number
  /** Row (from top) where the eye line lands. */
  eyeY: number
  /** Head-height fraction actually targeted (spec mid or default mid). */
  headHeightRatioTarget: number
  warnings: CropWarning[]
}

const LARGE_ROLL_DEG = 8

/**
 * Plan the eye-line-anchored crop:
 *   1. counter-rotate by the eye-line roll so the head is upright
 *   2. scale so head height (headTop→chin) hits the spec's headHeightRatio midpoint
 *   3. place the eye line at eyeLineRatio of canvas height, horizontally centered
 * Pure geometry — no pixels touched.
 */
export function planCrop(face: FaceLandmarks, target: CropTarget): CropPlan {
  const { width: W, height: H } = target
  const [ratioLo, ratioHi] = target.face.headHeightRatio ?? DEFAULT_HEAD_HEIGHT_RATIO
  const ratioMid = (ratioLo + ratioHi) / 2
  const eyeLineRatio = target.face.eyeLineRatio ?? DEFAULT_EYE_LINE_RATIO

  // Upright head geometry (counter-rotate around the eye anchor)
  const headTopUp = rotateAround(face.headTop, face.eyesCenter, -face.eyeLineAngle)
  const chinUp = rotateAround(face.chin, face.eyesCenter, -face.eyeLineAngle)
  const headH = Math.abs(chinUp.y - headTopUp.y)
  const targetHeadH = H * ratioMid
  const scale = headH > 1 ? targetHeadH / headH : 1

  const warnings: CropWarning[] = []
  const rollDeg = (face.eyeLineAngle * 180) / Math.PI
  if (Math.abs(rollDeg) > LARGE_ROLL_DEG) {
    warnings.push({
      code: "large-roll",
      message: `eye line tilted ${rollDeg.toFixed(1)}°; consider a straighter photo`,
    })
  }
  if (scale > 1.05) {
    warnings.push({
      code: "upscale",
      message: `source head is only ${Math.round(1 / scale)}× smaller than target; output will be soft`,
    })
  }

  return {
    width: W,
    height: H,
    scale,
    rollDegrees: -rollDeg,
    eyeY: H * eyeLineRatio,
    headHeightRatioTarget: ratioMid,
    warnings,
  }
}

/** User fine-tuning layered on top of the planned crop (all optional). */
export interface CropAdjust {
  /** Shift the anchor right, pixels on the spec canvas. */
  dx?: number
  /** Shift the anchor down, pixels on the spec canvas. */
  dy?: number
  /** Extra zoom (1 = planned scale). */
  scale?: number
  /** Extra clockwise rotation of the portrait, degrees. */
  rotateDeg?: number
}

/**
 * Render the spec-sized portrait: inverse-mapped bilinear sampling with
 * premultiplied alpha and edge-clamped extension (out-of-bounds areas repeat
 * the nearest edge pixel — for solid-background photos this reads as a clean
 * background extension, which is exactly what exam portals expect).
 */
export function renderToSpec(
  src: RgbaImage,
  face: FaceLandmarks,
  target: CropTarget,
  adjust: CropAdjust = {},
): RgbaImage {
  const plan = planCrop(face, target)
  const out = blankImage(plan.width, plan.height)
  const { data: sd, width: sw, height: sh } = src
  const { data: od } = out

  const s = plan.scale * (adjust.scale ?? 1)
  // user rotation adds to the counter-roll: sampling angle = roll − userRot
  const rollRad = face.eyeLineAngle - ((adjust.rotateDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(rollRad)
  const sin = Math.sin(rollRad)
  const cx = face.eyesCenter.x
  const cy = face.eyesCenter.y
  const anchorX = plan.width / 2 + (adjust.dx ?? 0)
  const anchorY = plan.eyeY + (adjust.dy ?? 0)

  for (let oy = 0; oy < plan.height; oy++) {
    for (let ox = 0; ox < plan.width; ox++) {
      // inverse transform: canvas → upright frame → source frame
      const ux = (ox + 0.5 - anchorX) / s
      const uy = (oy + 0.5 - anchorY) / s
      // sample center in source coords (rotate by +roll around eyes center)
      const fx = cx + ux * cos - uy * sin - 0.5
      const fy = cy + ux * sin + uy * cos - 0.5

      // bilinear with edge clamp (clamping = edge extension)
      const x0 = Math.min(sw - 1, Math.max(0, Math.floor(fx)))
      const y0 = Math.min(sh - 1, Math.max(0, Math.floor(fy)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const wx = Math.min(1, Math.max(0, fx - x0))
      const wy = Math.min(1, Math.max(0, fy - y0))

      const p00 = (y0 * sw + x0) * 4
      const p01 = (y0 * sw + x1) * 4
      const p10 = (y1 * sw + x0) * 4
      const p11 = (y1 * sw + x1) * 4
      const dst = (oy * plan.width + ox) * 4

      // straight-alpha interpolation for A; premultiplied for RGB (no edge bleed)
      const a00 = sd[p00 + 3]! / 255
      const a01 = sd[p01 + 3]! / 255
      const a10 = sd[p10 + 3]! / 255
      const a11 = sd[p11 + 3]! / 255
      const aTop = a00 + (a01 - a00) * wx
      const aBot = a10 + (a11 - a10) * wx
      const alpha = aTop + (aBot - aTop) * wy
      od[dst + 3] = alpha * 255
      for (let c = 0; c < 3; c++) {
        const v00 = sd[p00 + c]! * a00
        const v01 = sd[p01 + c]! * a01
        const v10 = sd[p10 + c]! * a10
        const v11 = sd[p11 + c]! * a11
        const top = v00 + (v01 - v00) * wx
        const bot = v10 + (v11 - v10) * wx
        const premul = top + (bot - top) * wy
        od[dst + c] = alpha < 1e-6 ? 0 : premul / alpha
      }
    }
  }
  return out
}
