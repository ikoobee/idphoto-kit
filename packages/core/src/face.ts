/**
 * Face adapter contract. Implementations live at the platform layer
 * (browser: MediaPipe FaceLandmarker; server: RetinaFace). The core pipeline
 * only ever consumes this geometry, so tests can drive it with synthetic data.
 */

export interface Point {
  x: number
  y: number
}

/**
 * Upright-frame face geometry (source pixel coordinates).
 * All points must already account for EXIF orientation.
 */
export interface FaceLandmarks {
  /** Midpoint of the two eye centers — the crop anchor. */
  eyesCenter: Point
  /** Roll angle of the eye line in radians (positive = line tilted cw). */
  eyeLineAngle: number
  /** Estimated top of the skull (hair included where visible). */
  headTop: Point
  /** Chin bottom. Head height = |chin.y - headTop.y| after roll correction. */
  chin: Point
}

/**
 * Crop-relevant subset of a spec. Structurally satisfied by the zod-parsed
 * Spec from @idphoto-kit/specs — core stays dependency-free.
 */
export interface CropTarget {
  width: number
  height: number
  face: {
    headHeightRatio: readonly [number, number] | null
    eyeLineRatio: number | null
  }
}

/** Engine defaults when a spec leaves face ratios unset. */
export const DEFAULT_HEAD_HEIGHT_RATIO: readonly [number, number] = [0.55, 0.7]
export const DEFAULT_EYE_LINE_RATIO = 0.42

/** Rotate p around center by angle (radians, ccw-positive in screen coords). */
export function rotateAround(p: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}
