import {
  type CropAdjust,
  type CropPlan,
  type CropTarget,
  crop,
  type FaceLandmarks,
  planCrop,
  type RgbaImage,
  readJpegOrientation,
  renderToSpec,
  resizeBilinear,
} from "@idphoto-kit/core"
import type { Spec } from "@idphoto-kit/specs/browser"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { loadSpecs } from "./data.ts"
import { MediaPipeFace } from "./models/face.ts"

const NO_ADJUST: CropAdjust = { dx: 0, dy: 0, scale: 1, rotateDeg: 0 }

interface Processed {
  source: RgbaImage
  face: FaceLandmarks | null
  target: CropTarget
  adjust: CropAdjust
  output: RgbaImage
  kb: number | null
  exifOrientation: number | null
}

export function App() {
  const specs = useMemo(() => loadSpecs(), [])
  const [selected, setSelected] = useState<Spec | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proc, setProc] = useState<Processed | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceModel = useMemo(() => new MediaPipeFace(), [])

  // Paint AFTER the canvas is mounted: proc changes land in the DOM first
  // (the processing view stays mounted from the moment a file is picked),
  // then this effect repaints — never paint into a not-yet-existing canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!proc?.output || !canvas) return
    canvas.width = proc.output.width
    canvas.height = proc.output.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(proc.output.data), proc.output.width, proc.output.height),
      0,
      0,
    )
  }, [proc])

  async function measureKb(out: RgbaImage): Promise<number> {
    const canvas = document.createElement("canvas")
    canvas.width = out.width
    canvas.height = out.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2D canvas unavailable")
    ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(Math.round(b.size / 1024)) : reject(new Error("encode failed"))),
        "image/jpeg",
        0.92,
      ),
    )
  }

  /** Compute the spec output (no painting — the effect owns the canvas). */
  async function compute(state: Processed): Promise<Processed> {
    const output = state.face
      ? renderToSpec(state.source, state.face, state.target, state.adjust)
      : fitCenter(state.source, state.target.width, state.target.height)
    const kb = await measureKb(output)
    return { ...state, output, kb }
  }

  async function onFile(file: File) {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const orientation = readJpegOrientation(bytes)
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      const source = bitmapToRgba(bitmap)
      bitmap.close()

      let face: FaceLandmarks | null = null
      try {
        face = await faceModel.detect(source)
      } catch (e) {
        console.warn("face detection unavailable, falling back to center crop", e)
      }

      const target: CropTarget = {
        width: selected.size.width,
        height: selected.size.height,
        face: selected.face,
      }
      const state: Processed = {
        source,
        face,
        target,
        adjust: { ...NO_ADJUST },
        output: blank(target),
        kb: null,
        exifOrientation: orientation,
      }
      setProc(await compute(state))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onAdjust(patch: Partial<CropAdjust>) {
    if (!proc || busy) return
    setProc({ ...proc, adjust: { ...proc.adjust, ...patch } })
    setProc(await compute({ ...proc, adjust: { ...proc.adjust, ...patch } }))
  }

  const plan: CropPlan | null = proc?.face ? planCrop(proc.face, proc.target) : null
  const inFlow = selected !== null && (busy || proc !== null)

  return (
    <main>
      <header>
        <h1>
          idphoto<span>.</span>kit
        </h1>
        <p>Privacy-first ID photos — everything stays in your browser.</p>
      </header>

      {!inFlow && selected && !busy ? (
        <>
          <SpecsPage specs={specs} selected={selected} onSelect={(s) => setSelected(s)} />
          <section class="work" style="margin-top:16px">
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
              📁 Choose a photo (never uploaded anywhere)
            </label>
            {error && <p class="err">{error}</p>}
            <p class="dim small">Face-anchored alignment runs on-device via MediaPipe.</p>
          </section>
        </>
      ) : !inFlow ? (
        <SpecsPage
          specs={specs}
          selected={null}
          onSelect={(s) => {
            setSelected(s)
            setProc(null)
          }}
        />
      ) : (
        <section class="work">
          <div class="bar">
            <button
              type="button"
              class="ghost"
              onClick={() => {
                setSelected(null)
                setProc(null)
              }}
            >
              ← all specs
            </button>
            <span class="dim">
              {selected?.name.en} · {selected?.size.width}×{selected?.size.height}px
              {selected?.file.maxKB ? ` · ≤${selected.file.maxKB}KB` : ""}
            </span>
          </div>

          <div class="split">
            <div class="stage">
              <canvas ref={canvasRef} style={proc ? "" : "visibility:hidden"} />
              {busy && <p class="dim">Processing…</p>}
              {error && <p class="err">{error}</p>}
              {proc && (
                <label class="drop small-pad">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0]
                      if (f) onFile(f)
                    }}
                  />
                  📁 Change photo (never uploaded anywhere)
                </label>
              )}
            </div>

            {proc && (
              <aside class="panel">
                <h3>Fine-tune</h3>
                <Slider
                  label="Zoom"
                  min={0.8}
                  max={1.4}
                  step={0.01}
                  value={proc.adjust.scale ?? 1}
                  onInput={(v) => onAdjust({ scale: v })}
                />
                <Slider
                  label="Horizontal"
                  min={-60}
                  max={60}
                  step={1}
                  value={proc.adjust.dx ?? 0}
                  onInput={(v) => onAdjust({ dx: v })}
                />
                <Slider
                  label="Vertical"
                  min={-60}
                  max={60}
                  step={1}
                  value={proc.adjust.dy ?? 0}
                  onInput={(v) => onAdjust({ dy: v })}
                />
                <Slider
                  label="Rotate°"
                  min={-10}
                  max={10}
                  step={0.5}
                  value={proc.adjust.rotateDeg ?? 0}
                  onInput={(v) => onAdjust({ rotateDeg: v })}
                />

                <h3>Background</h3>
                <div class="dots big">
                  {selected?.background.allowed.map((c) => (
                    <i key={c} style={`background:${c}`} title={c} />
                  ))}
                </div>
                <p class="dim small">
                  Background swap ships with the matting model asset (Release models-v0, pending
                  upload). The face-anchored crop above is fully functional.
                </p>

                <h3>Checklist</h3>
                <ul class="checks">
                  <Check ok label={`Size ${proc.target.width}×${proc.target.height}px`} />
                  <Check
                    ok={proc.face !== null}
                    label={
                      proc.face
                        ? "Face-anchored (eye line / head ratio)"
                        : "Face not found — center crop fallback"
                    }
                  />
                  {plan?.warnings.map((w) => (
                    <Check key={w.code} ok={false} label={w.message} />
                  ))}
                  {proc.exifOrientation && proc.exifOrientation > 1 ? (
                    <Check ok label={`EXIF orientation ${proc.exifOrientation} corrected`} />
                  ) : null}
                  {selected?.file.maxKB ? (
                    proc.kb !== null ? (
                      <Check
                        ok={proc.kb <= selected.file.maxKB}
                        label={`File size ${proc.kb}KB / ≤${selected.file.maxKB}KB${
                          proc.kb > selected.file.maxKB
                            ? " — target-KB export compresses this on download"
                            : ""
                        }`}
                      />
                    ) : (
                      <Check ok label="Measuring file size…" />
                    )
                  ) : null}
                </ul>
              </aside>
            )}
          </div>
        </section>
      )}
    </main>
  )
}

function blank(target: CropTarget): RgbaImage {
  return {
    data: new Uint8ClampedArray(target.width * target.height * 4),
    width: target.width,
    height: target.height,
  }
}

function SpecsPage(props: { specs: Spec[]; selected: Spec | null; onSelect: (s: Spec) => void }) {
  return (
    <section class="grid">
      {props.specs.map((s) => (
        <button
          type="button"
          class={`card${props.selected?.slug === s.slug ? " sel" : ""}`}
          key={s.slug}
          onClick={() => props.onSelect(s)}
        >
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
  )
}

function Slider(props: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onInput: (v: number) => void
}) {
  return (
    <label class="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onInput(+e.currentTarget.value)}
      />
    </label>
  )
}

function Check(props: { ok: boolean; label: string }) {
  return (
    <li class={props.ok ? "ok" : "warn"}>
      <span>{props.ok ? "✓" : "!"}</span>
      {props.label}
    </li>
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

/** Center crop to target aspect (cover, slight upward bias), exact px resize. */
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
