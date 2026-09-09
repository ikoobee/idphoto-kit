import { blankImage, type RgbaImage } from "./types.ts"

export interface PrintLayoutOptions {
  /** Paper size in pixels. Default: 6-inch sheet 1800×1200 @300dpi. */
  paperWidth?: number
  paperHeight?: number
  /** Dashed cut guides around each tile. Default true. */
  cutLines?: boolean
  /** Minimum gap (px) between tiles and to the paper edge. Default 10. */
  minGap?: number
}

export interface LayoutResult {
  sheet: RgbaImage
  cols: number
  rows: number
  count: number
}

/**
 * Tile a portrait across a print sheet (default 6-inch / 300dpi). Column count
 * is chosen for the most visually balanced gaps: a 1-inch portrait lands on
 * the classic 4×2 = 8 tiles with equal ~124px gutters, matching what photo
 * labs hand you. White background; optional dashed cut guides.
 */
export function layoutPrintSheet(
  portrait: RgbaImage,
  options: PrintLayoutOptions = {},
): LayoutResult {
  const paperW = options.paperWidth ?? 1800
  const paperH = options.paperHeight ?? 1200
  const minGap = options.minGap ?? 10
  const cutLines = options.cutLines ?? true

  if (portrait.width > paperW - 2 * minGap || portrait.height > paperH - 2 * minGap) {
    throw new Error("portrait does not fit the print sheet")
  }

  const rows = Math.max(1, Math.floor((paperH - minGap) / (portrait.height + minGap)))
  let best: { cols: number; gapX: number; gapY: number; diff: number } | null = null
  const maxCols = Math.max(1, Math.floor((paperW - minGap) / (portrait.width + minGap)))
  for (let cols = 1; cols <= maxCols; cols++) {
    const gapX = (paperW - cols * portrait.width) / (cols + 1)
    const gapY = (paperH - rows * portrait.height) / (rows + 1)
    if (gapX < minGap || gapY < minGap) continue
    const diff = Math.abs(gapX - gapY)
    // prefer balanced gutters; on ties, more tiles wins
    if (
      !best ||
      diff < best.diff - 1e-9 ||
      (Math.abs(diff - best.diff) < 1e-9 && cols > best.cols)
    ) {
      best = { cols, gapX, gapY, diff }
    }
  }
  if (!best) throw new Error("no valid tiling fits the print sheet")

  const sheet = blankImage(paperW, paperH)
  const { data: sd } = sheet
  // white paper
  for (let i = 0; i < paperW * paperH; i++) {
    sd[i * 4] = 255
    sd[i * 4 + 1] = 255
    sd[i * 4 + 2] = 255
    sd[i * 4 + 3] = 255
  }

  const { cols, gapX, gapY } = best
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(gapX + c * (portrait.width + gapX))
      const y0 = Math.round(gapY + r * (portrait.height + gapY))
      stamp(sheet, portrait, x0, y0)
      if (cutLines) drawCutLines(sheet, x0, y0, portrait.width, portrait.height)
    }
  }

  return { sheet, cols, rows, count: cols * rows }
}

function stamp(sheet: RgbaImage, tile: RgbaImage, x0: number, y0: number): void {
  for (let y = 0; y < tile.height; y++) {
    const src = y * tile.width * 4
    const dst = ((y0 + y) * sheet.width + x0) * 4
    sheet.data.set(tile.data.subarray(src, src + tile.width * 4), dst)
  }
}

/** 4-on / 4-off dashed rectangle just outside the tile, mid-gray. */
function drawCutLines(sheet: RgbaImage, x0: number, y0: number, w: number, h: number): void {
  const dash = 4
  const draw = (x: number, y: number) => {
    const i = (y * sheet.width + x) * 4
    sheet.data[i] = 160
    sheet.data[i + 1] = 160
    sheet.data[i + 2] = 160
    sheet.data[i + 3] = 255
  }
  for (const yy of [y0 - 1, y0 + h]) {
    for (let x = x0; x < x0 + w; x++)
      if ((x / dash) % 2 < 1) draw(x, Math.min(sheet.height - 1, Math.max(0, yy)))
  }
  for (const xx of [x0 - 1, x0 + w]) {
    for (let y = y0; y < y0 + h; y++)
      if ((y / dash) % 2 < 1) draw(Math.min(sheet.width - 1, Math.max(0, xx)), y)
  }
}
