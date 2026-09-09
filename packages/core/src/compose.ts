import type { AlphaMat } from "./matte.ts"
import type { RgbaImage } from "./types.ts"
import { blankImage } from "./types.ts"

/** Background options for compositing a matted portrait. */
export type BackgroundOption =
  | { kind: "transparent" }
  | { kind: "solid"; color: string } // #RRGGBB
  | {
      kind: "gradient"
      from: string // #RRGGBB at the top (vertical) / left (horizontal)
      to: string
      direction?: "vertical" | "horizontal" // default vertical
    }

/** Parse #RRGGBB into [r, g, b]; throws on malformed input. */
export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) throw new Error(`invalid hex color: ${hex}`)
  const v = Number.parseInt(m[1]!, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/**
 * Composite a matted portrait onto a background:
 *  - transparent → straight-alpha RGBA (portrait colors + matte alpha)
 *  - solid/gradient → standard "over" blending, fully opaque output
 *
 * The portrait is expected as straight (non-premultiplied) RGBA, which is what
 * decode pipelines produce; the matte grid must match the image dimensions.
 */
export function composeBackground(
  portrait: RgbaImage,
  alpha: AlphaMat,
  bg: BackgroundOption,
): RgbaImage {
  if (alpha.length !== portrait.width * portrait.height) {
    throw new Error("alpha matte dimensions do not match the portrait")
  }
  const out = blankImage(portrait.width, portrait.height)
  const { data: pd, width: w, height: h } = portrait
  const { data: od } = out

  if (bg.kind === "transparent") {
    for (let i = 0; i < alpha.length; i++) {
      od[i * 4] = pd[i * 4]!
      od[i * 4 + 1] = pd[i * 4 + 1]!
      od[i * 4 + 2] = pd[i * 4 + 2]!
      od[i * 4 + 3] = alpha[i]!
    }
    return out
  }

  // Precompute the per-pixel background color source
  const from = parseHexColor(bg.kind === "solid" ? bg.color : bg.from)
  const to = bg.kind === "solid" ? from : parseHexColor(bg.to)
  const horizontal = bg.kind === "gradient" && bg.direction === "horizontal"
  const span = horizontal ? w - 1 : h - 1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const t = span > 0 ? (horizontal ? x : y) / span : 0
      const a = alpha[i]! / 255
      const p = i * 4
      for (let c = 0; c < 3; c++) {
        const bgc = from[c]! + (to[c]! - from[c]!) * t
        od[p + c] = pd[p + c]! * a + bgc * (1 - a)
      }
      od[p + 3] = 255
    }
  }
  return out
}
