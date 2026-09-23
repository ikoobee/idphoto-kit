import type { OutfitShape, PathCommand, RgbaImage } from "@idphoto-kit/core"

/**
 * Rasterize core's outfit path commands into an RGBA layer the pixel-side
 * merge (core.mergeOutfitLayer) can composite. This is the only place the
 * vector data touches a canvas — core stays platform-free.
 */
export function renderOutfitLayer(shapes: OutfitShape[], width: number, height: number): RgbaImage {
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("2D canvas unavailable")
  for (const shape of shapes) {
    ctx.beginPath()
    for (const cmd of shape.path) applyCommand(ctx, cmd)
    ctx.fillStyle = shape.fill
    ctx.fill()
  }
  const id = ctx.getImageData(0, 0, width, height)
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
    case "Z":
      ctx.closePath()
      break
  }
}
