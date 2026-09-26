import type { OutfitShape, Paint, PathCommand, RgbaImage } from "@idphoto-kit/core"

/**
 * Rasterize core's outfit path commands and paint specs into an RGBA layer
 * that core.mergeOutfitLayer can composite. This is the only place the vector
 * data touches a canvas — core stays platform-free.
 *
 * `lightFromLeft` flips horizontal gradients so the garment's lighting agrees
 * with the photo's. A light deterministic fabric grain is baked in: flat fills
 * are the #1 "looks fake" cue for synthetic garments.
 */
export function renderOutfitLayer(
  shapes: OutfitShape[],
  width: number,
  height: number,
  opts: { lightFromLeft?: boolean } = {},
): RgbaImage {
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("2D canvas unavailable")
  for (const shape of shapes) {
    ctx.beginPath()
    for (const cmd of shape.path) applyCommand(ctx, cmd)
    let paint = shape.paint
    if (paint.kind === "linear" && paint.dir === "h" && opts.lightFromLeft === false) {
      paint = {
        ...paint,
        stops: [...paint.stops].reverse().map(([t, color]) => [1 - t, color] as [number, string]),
      }
    }
    ctx.fillStyle = makePaint(ctx, paint, bboxOf(shape.path))
    ctx.fill()
  }
  const id = ctx.getImageData(0, 0, width, height)
  addFabricGrain(id.data)
  return { data: id.data, width, height }
}

function applyCommand(ctx: CanvasRenderingContext2D, cmd: PathCommand): void {
  switch (cmd.op) {
    case "M":
      ctx.moveTo(cmd.x, cmd.y)
      break
    case "L":
      ctx.lineTo(cmd.x, cmd.y)
      break
    case "Q":
      ctx.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x, cmd.y)
      break
    case "E":
      ctx.ellipse(cmd.cx, cmd.cy, Math.max(0.1, cmd.rx), Math.max(0.1, cmd.ry), 0, 0, 2 * Math.PI)
      break
    case "Z":
      ctx.closePath()
      break
  }
}

function makePaint(
  ctx: CanvasRenderingContext2D,
  paint: Paint,
  box: { x0: number; y0: number; x1: number; y1: number },
): string | CanvasGradient {
  if (paint.kind === "solid") return paint.color
  if (paint.kind === "linear") {
    const g =
      paint.dir === "v"
        ? ctx.createLinearGradient(0, box.y0, 0, box.y1)
        : ctx.createLinearGradient(box.x0, 0, box.x1, 0)
    for (const [t, color] of paint.stops) g.addColorStop(clamp01(t), color)
    return g
  }
  const g = ctx.createRadialGradient(
    paint.cx,
    paint.cy,
    0,
    paint.cx,
    paint.cy,
    Math.max(0.1, paint.r),
  )
  for (const [t, color] of paint.stops) g.addColorStop(clamp01(t), color)
  return g
}

function bboxOf(path: PathCommand[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  const see = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  for (const cmd of path) {
    if (cmd.op === "M" || cmd.op === "L") see(cmd.x, cmd.y)
    else if (cmd.op === "Q") {
      see(cmd.cx, cmd.cy)
      see(cmd.x, cmd.y)
    } else if (cmd.op === "E") {
      see(cmd.cx - cmd.rx, cmd.cy - cmd.ry)
      see(cmd.cx + cmd.rx, cmd.cy + cmd.ry)
    }
  }
  if (x0 > x1) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  return { x0, y0, x1, y1 }
}

/** ±6 luminance jitter on painted pixels — deterministic, no RNG state. */
function addFabricGrain(data: Uint8ClampedArray): void {
  for (let p = 0; p < data.length; p += 4) {
    if ((data[p + 3] ?? 255) === 0) continue
    const i = p >> 2
    const x = i & 1023
    const y = i >> 10
    const n = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 12 - 6
    data[p] += n
    data[p + 1] += n
    data[p + 2] += n
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
