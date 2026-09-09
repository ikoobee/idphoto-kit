export type { CropPlan, CropWarning, CropWarningCode } from "./align.ts"
export { planCrop, renderToSpec } from "./align.ts"
export type { BackgroundOption } from "./compose.ts"
export { composeBackground, parseHexColor } from "./compose.ts"
export type { Orientation } from "./exif.ts"
export { readJpegOrientation } from "./exif.ts"
export type { CropTarget, FaceLandmarks, Point } from "./face.ts"
export {
  DEFAULT_EYE_LINE_RATIO,
  DEFAULT_HEAD_HEIGHT_RATIO,
  rotateAround,
} from "./face.ts"
export { crop, resizeBilinear } from "./geometry.ts"
export type { AlphaMat, EdgeRefineOptions, MattingModel } from "./matte.ts"
export { refineAlpha } from "./matte.ts"
export {
  applyOrientation,
  flipH,
  flipV,
  rotate90,
  rotate180,
  transpose,
} from "./orient.ts"
export type { RgbaImage } from "./types.ts"
export { blankImage, cloneImage, fromImageData, makeImage } from "./types.ts"
