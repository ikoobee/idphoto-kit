import { crop, type RgbaImage, readJpegOrientation, resizeBilinear } from "@idphoto-kit/core"
import type { Spec } from "@idphoto-kit/specs/browser"
import { useMemo, useRef, useState } from "preact/hooks"
import { loadSpecs } from "./data.ts"

interface Result {
  url: string
  kb: number
  width: number
  height: number
  orientation: number | null
}

export function App() {
  const specs = useMemo(() => loadSpecs(), [])
  const [selected, setSelected] = useState<Spec | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  async function onFile(file: File) {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const orientation = readJpegOrientation(bytes)
      // "from-image" makes the browser apply EXIF orientation while decoding
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      const rgba = bitmapToRgba(bitmap)
      bitmap.close()

      const { width, height } = selected.size
      const out = fitCenter(rgba, width, height)

      const canvas = canvasRef.current
      if (!canvas) throw new Error("canvas missing")
      canvas.width = out.width
      canvas.height = out.height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("2D canvas unavailable")
      ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
      const blob = await canvasToJpeg(canvas, 0.92)
      if (result) URL.revokeObjectURL(result.url)
      setResult({
        url: URL.createObjectURL(blob),
        kb: Math.round(blob.size / 1024),
        width,
        height,
        orientation,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <header>
        <h1>
          idphoto<span>.</span>kit
        </h1>
        <p>Privacy-first ID photos — everything stays in your browser.</p>
      </header>

      {!selected ? (
        <section class="grid">
          {specs.map((s) => (
            <button type="button" class="card" key={s.slug} onClick={() => setSelected(s)}>
              <b>{s.name.en}</b>
              <span class="dim">
                {s.name.zh} · {s.size.width}×{s.size.height}px
                {s.file.maxKB ? ` · ≤${s.file.maxKB}KB` : ""}
              </span>
              <span class="dots">
                {s.background.allowed.map((c) => (
                  <i key={c} style={`background:${c}`} />
                ))}
              </span>
            </button>
          ))}
        </section>
      ) : (
        <section class="work">
          <div class="bar">
            <button type="button" class="ghost" onClick={() => setSelected(null)}>
              ← all specs
            </button>
            <span class="dim">
              {selected.name.en} · {selected.size.width}×{selected.size.height}px
              {selected.file.maxKB ? ` · ≤${selected.file.maxKB}KB` : ""}
            </span>
          </div>
          <label class="drop">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                if (f) onFile(f)
              }}
            />
            {busy ? "Processing…" : "📁 Choose a photo (never uploaded anywhere)"}
          </label>
          {error && <p class="err">{error}</p>}
          <canvas ref={canvasRef} class={result ? "" : "hidden"} />
          {result && (
            <p class="meta">
              {result.width}×{result.height}px · {result.kb} KB
              {selected.file.maxKB
                ? result.kb <= selected.file.maxKB
                  ? " ✓ within limit"
                  : ` ⚠ over ${selected.file.maxKB}KB — target-size compression lands next`
                : ""}
              {result.orientation && result.orientation > 1
                ? ` · EXIF orientation ${result.orientation} corrected`
                : ""}
            </p>
          )}
          <p class="dim small">
            Placeholder center-crop for now — face-anchored alignment (eye line, head-height ratio)
            activates with the on-device face model. Background swap and target-KB export are next
            in the pipeline.
          </p>
        </section>
      )}
    </main>
  )
}

function bitmapToRgba(bmp: ImageBitmap): RgbaImage {
  const c = document.createElement("canvas")
  c.width = bmp.width
  c.height = bmp.height
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("2D canvas unavailable")
  ctx.drawImage(bmp, 0, 0)
  const id = ctx.getImageData(0, 0, c.width, c.height)
  return { data: id.data, width: id.width, height: id.height }
}

/** Center crop to target aspect (cover, slight upward bias for faces), exact px resize. */
function fitCenter(img: RgbaImage, width: number, height: number): RgbaImage {
  const targetAspect = width / height
  const srcAspect = img.width / img.height
  let w = img.width
  let h = img.height
  if (srcAspect > targetAspect) w = Math.round(img.height * targetAspect)
  else h = Math.round(img.width / targetAspect)
  const x = Math.floor((img.width - w) / 2)
  const y = Math.max(0, Math.floor((img.height - h) / 2) - Math.round(h * 0.1))
  const cropped = crop(img, x, y, w, h)
  return cropped.width === width && cropped.height === height
    ? cropped
    : resizeBilinear(cropped, width, height)
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      "image/jpeg",
      quality,
    ),
  )
}
