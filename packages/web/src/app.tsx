import {
  type AlphaMat,
  type BackgroundOption,
  buildOutfitShapes,
  type CropAdjust,
  type CropTarget,
  type FaceLandmarks,
  fitJpegToTargetKB,
  layoutPrintSheet,
  type OutfitId,
  type OutfitShape,
  type RgbaImage,
  type SilhouetteMetrics,
  silhouetteMetrics,
} from "@idphoto-kit/core"
import type { Spec } from "@idphoto-kit/specs/browser"
import { SpecSchema } from "@idphoto-kit/specs/browser"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { CameraStream } from "./camera.ts"
import { loadSpecs } from "./data.ts"
import { downloadBytes, encodePng, imageToCanvas, makeJpegEncoder } from "./encode.ts"
import { type Lang, makeT } from "./i18n.ts"
import { MediaPipeFace } from "./models/face.ts"
import { SelfieSegmenterMatte } from "./models/selfie-seg.ts"
import { renderOutfitLayer } from "./outfit-render.ts"
import {
  composePortrait,
  demoSource,
  fileToSource,
  measureJpegKB,
  renderSpecImage,
} from "./pipeline.ts"
import { ROUTES, useHashRoute } from "./router.ts"

const NO_ADJUST: CropAdjust = { dx: 0, dy: 0, scale: 1, rotateDeg: 0 }
const NO_TONE = { brightness: 1, contrast: 1 }
const OUTFITS: { id: OutfitId | null; key: string }[] = [
  { id: null, key: "outfitNone" },
  { id: "suit", key: "outfitSuit" },
  { id: "career", key: "outfitCareer" },
  { id: "academic", key: "outfitAcademic" },
]
const STEP_NAMES = ["specs", "capture", "edit", "export"] as const
const STEP_LABELS: Record<(typeof STEP_NAMES)[number], { zh: string; en: string }> = {
  specs: { zh: "选规格", en: "Spec" },
  capture: { zh: "拍照/上传", en: "Capture" },
  edit: { zh: "编辑", en: "Edit" },
  export: { zh: "导出", en: "Export" },
}

interface Session {
  spec: Spec
  source: RgbaImage
  face: FaceLandmarks | null
  alpha: AlphaMat | null
  silhouette: SilhouetteMetrics | null
  matteError: string | null
  bg: BackgroundOption
  outfit: OutfitId | null
  adjust: CropAdjust
  tone: { brightness: number; contrast: number }
}

interface ProcStep {
  id: "decode" | "face" | "matte" | "done"
  state: "active" | "done" | "skipped"
}

type TFn = ReturnType<typeof makeT>

function specTarget(spec: Spec): CropTarget {
  return {
    width: spec.size.width,
    height: spec.size.height,
    face: {
      headHeightRatio: spec.face.headHeightRatio,
      eyeLineRatio: spec.face.eyeLineRatio,
    },
  }
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "zh")
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark")
  const t = useMemo(() => makeT(lang), [lang])
  const specs = useMemo(() => loadSpecs(), [])
  const [route, go] = useHashRoute()
  const [pickedSpec, setPickedSpec] = useState<Spec | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [steps, setSteps] = useState<ProcStep[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const faceModel = useMemo(() => new MediaPipeFace(), [])
  // default tier: MediaPipe selfie segmentation (CDN, always available);
  // the MODNet ONNX upgrade tier activates via the manifest once models-v0 ships
  const matteModel = useMemo(() => new SelfieSegmenterMatte(), [])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light"
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])
  useEffect(() => localStorage.setItem("lang", lang), [lang])

  const routeOrder = ROUTES.indexOf(route)
  const stepReached = (i: number): boolean =>
    i === 0 ? true : i <= 1 ? routeOrder >= 1 || pickedSpec !== null : session !== null

  /** Decode → face → matte, with visible per-step status; lands on #/edit. */
  async function prepare(spec: Spec, source: RgbaImage) {
    setError(null)
    setSteps([
      { id: "decode", state: "done" },
      { id: "face", state: "active" },
      { id: "matte", state: "active" },
      { id: "done", state: "active" },
    ])
    let face: FaceLandmarks | null = null
    try {
      face = await faceModel.detect(source)
    } catch (e) {
      console.warn("face detection unavailable", e)
    }
    setSteps((s) => s?.map((x) => (x.id === "face" ? { ...x, state: "done" } : x)) ?? null)

    let alpha: AlphaMat | null = null
    let matteError: string | null = null
    try {
      alpha = await matteModel.matte(source)
    } catch (e) {
      matteError = e instanceof Error ? e.message : String(e)
      console.warn("matting unavailable — background swap disabled", e)
    }
    const silhouette = alpha ? silhouetteMetrics(alpha, source.width, source.height) : null
    setSteps(
      (s) =>
        s?.map((x) => (x.id === "matte" ? { ...x, state: alpha ? "done" : "skipped" } : x)) ?? null,
    )

    setSession({
      spec,
      source,
      face,
      alpha,
      silhouette,
      matteError,
      bg: { kind: "solid", color: spec.background.allowed[0] ?? "#FFFFFF" },
      outfit: null,
      adjust: { ...NO_ADJUST },
      tone: { ...NO_TONE },
    })
    setSteps((s) => s?.map((x) => (x.id === "done" ? { ...x, state: "done" } : x)) ?? null)
    setTimeout(() => {
      setSteps(null)
      go("edit")
    }, 250)
  }

  async function onCaptureSource(spec: Spec, getSource: () => RgbaImage | Promise<RgbaImage>) {
    setBusy(true)
    setError(null)
    try {
      const source = await getSource()
      await prepare(spec, source)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function patchSession(patch: Partial<Session>) {
    setSession((s) => (s ? { ...s, ...patch } : s))
  }

  async function retryMatte() {
    if (!session) return
    setBusy(true)
    matteModel.reset()
    try {
      const alpha = await matteModel.matte(session.source)
      patchSession({
        alpha,
        silhouette: silhouetteMetrics(alpha, session.source.width, session.source.height),
        matteError: null,
      })
    } catch (e) {
      patchSession({ matteError: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  function restart() {
    setSession(null)
    setPickedSpec(null)
    go("specs")
  }

  return (
    <main data-route={route}>
      <header class="top">
        <div class="brand">
          <span class="logo">ID</span>
          <div>
            <b>{t("brand")}</b>
            <span class="dim small">{t("tagline")}</span>
          </div>
        </div>
        <nav class="steps">
          {ROUTES.map((r, i) => (
            <button
              type="button"
              key={r}
              class={`step${r === route ? " cur" : ""}${stepReached(i) ? " reach" : ""}`}
              disabled={!stepReached(i)}
              onClick={() => go(r)}
            >
              <i>{i + 1}</i>
              {STEP_LABELS[r][lang]}
            </button>
          ))}
        </nav>
        <div class="hbtns">
          <button type="button" class="hbtn" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang === "zh" ? "EN" : "中"}
          </button>
          <button type="button" class="hbtn" onClick={() => setDark(!dark)}>
            ◐
          </button>
        </div>
      </header>

      {error && <p class="err banner">{error}</p>}
      {route === "specs" && (
        <SpecsPage
          t={t}
          lang={lang}
          specs={specs}
          onPick={(spec) => {
            setSession(null)
            setPickedSpec(spec)
            go("capture")
          }}
        />
      )}
      {route === "capture" &&
        (pickedSpec ? (
          <CapturePage
            t={t}
            spec={pickedSpec}
            busy={busy}
            steps={steps}
            onSource={(get) => onCaptureSource(pickedSpec, get)}
            onBack={() => go("specs")}
          />
        ) : (
          <Missing text={t("needSpec")} />
        ))}
      {route === "edit" &&
        (session ? (
          <EditPage
            t={t}
            lang={lang}
            session={session}
            onPatch={patchSession}
            onRetryMatte={retryMatte}
            busy={busy}
            onBack={() => go("capture")}
            onNext={() => go("export")}
            onRespec={() => go("specs")}
          />
        ) : (
          <Missing text={t("needPhoto")} />
        ))}
      {route === "export" &&
        (session ? (
          <ExportPage t={t} session={session} onRestart={restart} />
        ) : (
          <Missing text={t("needPhoto")} />
        ))}
    </main>
  )
}

function Missing(props: { text: string }) {
  return <p class="err banner">{props.text}</p>
}

/* ======================================================================
   PAGE 1 · SPECS
====================================================================== */

function SpecsPage(props: { t: TFn; lang: Lang; specs: Spec[]; onPick: (s: Spec) => void }) {
  const { t, lang } = props
  const [query, setQuery] = useState("")
  const [cat, setCat] = useState<string>("all")
  const [unit, setUnit] = useState<"mm" | "px">("px")
  const [cw, setCw] = useState(295)
  const [ch, setCh] = useState(413)
  const [dpi, setDpi] = useState(300)

  const cats: { id: string; key: string }[] = [
    { id: "all", key: "catAll" },
    { id: "std", key: "catStd" },
    { id: "exam", key: "catExam" },
    { id: "cert", key: "catCert" },
    { id: "visa", key: "catVisa" },
    { id: "job", key: "catJob" },
  ]

  const list = props.specs.filter((s) => {
    if (cat !== "all" && s.category !== cat) return false
    if (!query) return true
    const hay = [s.slug, s.name.zh, s.name.en, ...(s.aliases ?? [])].join(" ").toLowerCase()
    return hay.includes(query.toLowerCase())
  })

  function pickCustom() {
    const px =
      unit === "px"
        ? { w: cw, h: ch }
        : { w: Math.round((cw * dpi) / 25.4), h: Math.round((ch * dpi) / 25.4) }
    if (px.w < 50 || px.h < 50 || px.w > 4000 || px.h > 4000) return
    const spec = SpecSchema.parse({
      slug: "custom",
      name: { zh: "自定义", en: "Custom" },
      aliases: ["custom"],
      category: "std",
      region: "CN",
      size: { width: px.w, height: px.h, unit: "px", dpi, mm: null },
      background: { allowed: ["#FFFFFF", "#438EDB", "#D9001B"], transparent: true },
      file: { formats: ["jpg", "png"], maxKB: null },
      face: {},
      source: {
        name: "user-entered custom size",
        url: "https://github.com/ikoobee/idphoto-kit",
        checkedAt: new Date().toISOString().slice(0, 10),
      },
      notes: {},
    })
    props.onPick(spec)
  }

  return (
    <section class="page">
      <div class="pagehead">
        <h1>{t("specsTitle")}</h1>
        <p class="dim">{t("specsSub")}</p>
      </div>
      <div class="toolbar">
        <input
          class="search"
          type="search"
          placeholder={t("searchPh")}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="chips">
          {cats.map((c) => (
            <button
              type="button"
              key={c.id}
              class={`chip${cat === c.id ? " on" : ""}`}
              onClick={() => setCat(c.id)}
            >
              {t(c.key)}
            </button>
          ))}
        </div>
      </div>
      <div class="grid">
        {list.map((s) => (
          <button type="button" key={s.slug} class="card" onClick={() => props.onPick(s)}>
            <b>{lang === "zh" ? s.name.zh : s.name.en}</b>
            <span class="dim small">{(s.aliases ?? []).slice(0, 3).join(" · ") || s.slug}</span>
            <span class="meta">
              <i class="tag">
                {s.size.width}×{s.size.height}px
              </i>
              {s.size.mm && <i class="tag">{s.size.mm}mm</i>}
              <i class="tag">{s.size.dpi ?? 300}dpi</i>
              {s.file.maxKB && <i class="tag hot">≤{s.file.maxKB}KB</i>}
            </span>
            <span class="dots">
              {s.background.allowed.map((c) => (
                <i key={c} style={`background:${c}`} />
              ))}
            </span>
          </button>
        ))}
        {!list.length && <p class="dim">{t("noSpecs")}</p>}
      </div>

      <div class="custombox">
        <b>{t("custom")}</b>
        <div class="cgrid">
          <label>
            {t("unit")}
            <select value={unit} onChange={(e) => setUnit(e.currentTarget.value as "mm" | "px")}>
              <option value="px">px</option>
              <option value="mm">mm</option>
            </select>
          </label>
          <label>
            {t("widthW")}
            <input type="number" value={cw} onInput={(e) => setCw(+e.currentTarget.value)} />
          </label>
          <label>
            {t("heightH")}
            <input type="number" value={ch} onInput={(e) => setCh(+e.currentTarget.value)} />
          </label>
          <label>
            {t("dpiL")}
            <select value={dpi} onChange={(e) => setDpi(+e.currentTarget.value)}>
              <option value={300}>300</option>
              <option value={350}>350</option>
              <option value={600}>600</option>
            </select>
          </label>
          <button type="button" class="btn primary" onClick={pickCustom}>
            {t("useCustom")}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ======================================================================
   PAGE 2 · CAPTURE
====================================================================== */

function CapturePage(props: {
  t: TFn
  spec: Spec
  busy: boolean
  steps: ProcStep[] | null
  onSource: (get: () => RgbaImage | Promise<RgbaImage>) => void
  onBack: () => void
}) {
  const { t } = props
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cam, setCam] = useState<CameraStream | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => () => cam?.close(), [cam])

  async function startCam() {
    setCamError(null)
    try {
      const stream = await CameraStream.open()
      if (videoRef.current) stream.attach(videoRef.current)
      setCam(stream)
    } catch {
      setCamError(t("camDenied"))
    }
  }

  function shoot() {
    const v = videoRef.current
    if (!cam || !v) return
    props.onSource(() => cam.captureFrame(v))
    cam.close()
    setCam(null)
  }

  const stepLabel: Record<ProcStep["id"], string> = {
    decode: t("procDecoding"),
    face: t("procFace"),
    matte: t("procMatte"),
    done: t("procDone"),
  }

  return (
    <section class="page">
      <div class="pagehead row spread">
        <div>
          <h1>{t("capTitle")}</h1>
          <p class="dim">{t("capSub")}</p>
        </div>
        <button type="button" class="btn ghost" onClick={props.onBack}>
          ← {props.spec.name.zh} · {props.spec.size.width}×{props.spec.size.height}px
        </button>
      </div>

      <div class="capwrap">
        <div class="capcard">
          <h2>📷 {t("camera")}</h2>
          <p class="dim small">{t("camSub")}</p>
          <div class="camzone">
            <video ref={videoRef} autoplay playsinline muted hidden={!cam} />
            {cam && (
              <div class="guide">
                <div class="oval" />
              </div>
            )}
            {!cam && (
              <div class="camoff">
                <div class="big">📷</div>
                {camError ? <p class="err">{camError}</p> : <p>{t("startCam")} →</p>}
              </div>
            )}
          </div>
          <div class="row">
            {!cam ? (
              <button type="button" class="btn primary" disabled={props.busy} onClick={startCam}>
                {t("startCam")}
              </button>
            ) : (
              <>
                <button type="button" class="btn primary" disabled={props.busy} onClick={shoot}>
                  ◉ {t("shutter")}
                </button>
                <button
                  type="button"
                  class="btn ghost"
                  onClick={() => {
                    cam.close()
                    setCam(null)
                  }}
                >
                  {t("stopCam")}
                </button>
              </>
            )}
          </div>
        </div>

        <div class="capcard">
          <h2>🖼 {t("upload")}</h2>
          <p class="dim small">{t("upSub")}</p>
          <label
            class={`drop${dragOver ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) props.onSource(() => fileToSource(f))
            }}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={props.busy}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                if (f) props.onSource(() => fileToSource(f))
              }}
            />
            <span class="big">⇪</span>
            <b>{t("upload")}</b>
            <span class="dim small">{t("upHint")}</span>
          </label>
          <button
            type="button"
            class="btn ghost wide"
            disabled={props.busy}
            onClick={() => props.onSource(() => demoSource())}
          >
            {t("demo")}
          </button>
        </div>
      </div>

      {props.steps && (
        <ol class="proc">
          {props.steps.map((s) => (
            <li key={s.id} class={s.state}>
              {stepLabel[s.id]}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/* ======================================================================
   PAGE 3 · EDIT
====================================================================== */

function EditPage(props: {
  t: TFn
  lang: Lang
  session: Session
  onPatch: (patch: Partial<Session>) => void
  onRetryMatte: () => void
  busy: boolean
  onBack: () => void
  onNext: () => void
  onRespec: () => void
}) {
  const { t, session: s } = props
  const [tab, setTab] = useState<"bg" | "outfit" | "adj" | "chk">("bg")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [kb, setKb] = useState<number | null>(null)
  const target = useMemo(() => specTarget(s.spec), [s.spec])
  const matteDown = s.alpha === null
  const maxKB = s.spec.file.maxKB ?? 200

  // live preview: debounce pixel work, paint, and refresh the KB reading
  useEffect(() => {
    const timer = setTimeout(async () => {
      const cutout = composePortrait(s.source, s, {
        tone: s.tone,
        outfit: s.outfit,
        bg: s.bg,
        adjust: s.adjust,
      })
      const img = renderSpecImage(cutout, s.face, target, s.adjust)
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = img.width
        canvas.height = img.height
        canvas
          .getContext("2d")
          ?.putImageData(
            new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
            0,
            0,
          )
      }
      try {
        setKb(await measureJpegKB(img))
      } catch {
        setKb(null)
      }
    }, 40)
    return () => clearTimeout(timer)
  }, [s.source, s.face, s.alpha, s.silhouette, s.bg, s.outfit, s.adjust, s.tone, target])

  return (
    <section class="page">
      <div class="pagehead row spread">
        <div>
          <h1>
            {t("editTitle")} · {props.lang === "zh" ? s.spec.name.zh : s.spec.name.en}
          </h1>
          <p class="dim">{t("editSub")}</p>
        </div>
        <button type="button" class="btn ghost" onClick={props.onRespec}>
          {t("rePick")}
        </button>
      </div>

      <div class="editwrap">
        <div class="stage">
          <canvas
            ref={canvasRef}
            class={`preview${s.bg.kind === "transparent" ? " checker" : ""}`}
          />
          <div class="ruler dim small">
            <span>
              {target.width}×{target.height}px
            </span>
            {s.spec.size.mm && <span>{s.spec.size.mm}mm</span>}
            <span>{s.spec.size.dpi ?? 300} DPI</span>
          </div>
        </div>

        <aside class="panel">
          <div class="tabs">
            {(
              [
                ["bg", "tabBg"],
                ["outfit", "tabOutfit"],
                ["adj", "tabAdj"],
                ["chk", "tabChk"],
              ] as const
            ).map(([id, key]) => (
              <button
                type="button"
                key={id}
                class={`tab${tab === id ? " on" : ""}`}
                onClick={() => setTab(id)}
              >
                {t(key)}
              </button>
            ))}
          </div>

          {tab === "bg" && (
            <div class="tabbody">
              <div class="swatches">
                {s.spec.background.allowed.map((c) => (
                  <button
                    type="button"
                    key={c}
                    class={`swatch${s.bg.kind === "solid" && s.bg.color === c ? " on" : ""}`}
                    style={`background:${c}`}
                    disabled={matteDown}
                    onClick={() => props.onPatch({ bg: { kind: "solid", color: c } })}
                  />
                ))}
                {s.spec.background.transparent && (
                  <button
                    type="button"
                    class={`swatch checker${s.bg.kind === "transparent" ? " on" : ""}`}
                    disabled={matteDown}
                    onClick={() => props.onPatch({ bg: { kind: "transparent" } })}
                  >
                    {t("bgTrans")}
                  </button>
                )}
                <label class={`swatch custom${customOn(s.bg) ? " on" : ""}`}>
                  <input
                    type="color"
                    disabled={matteDown}
                    onInput={(e) =>
                      props.onPatch({ bg: { kind: "solid", color: e.currentTarget.value } })
                    }
                  />
                  🎨
                </label>
              </div>
              {matteDown && <MatteDownNote t={t} onRetry={props.onRetryMatte} busy={props.busy} />}
            </div>
          )}

          {tab === "outfit" && (
            <div class="tabbody">
              <div class="outfits">
                {OUTFITS.map((o) => (
                  <button
                    type="button"
                    key={o.key}
                    class={`outfit${s.outfit === o.id ? " on" : ""}`}
                    disabled={matteDown}
                    onClick={() => props.onPatch({ outfit: o.id })}
                  >
                    <img src={thumbFor(o.id)} alt={t(o.key)} />
                    <span>{t(o.key)}</span>
                  </button>
                ))}
              </div>
              <p class="dim small">{t("outfitNote")}</p>
              {matteDown && <MatteDownNote t={t} onRetry={props.onRetryMatte} busy={props.busy} />}
            </div>
          )}

          {tab === "adj" && (
            <div class="tabbody">
              <Slider
                label={t("dx")}
                min={-80}
                max={80}
                step={1}
                value={s.adjust.dx ?? 0}
                onInput={(v) => props.onPatch({ adjust: { ...s.adjust, dx: v } })}
              />
              <Slider
                label={t("dy")}
                min={-80}
                max={80}
                step={1}
                value={s.adjust.dy ?? 0}
                onInput={(v) => props.onPatch({ adjust: { ...s.adjust, dy: v } })}
              />
              <Slider
                label={t("zoom")}
                min={0.7}
                max={1.6}
                step={0.01}
                value={s.adjust.scale ?? 1}
                onInput={(v) => props.onPatch({ adjust: { ...s.adjust, scale: v } })}
              />
              <Slider
                label={t("rot")}
                min={-15}
                max={15}
                step={0.5}
                value={s.adjust.rotateDeg ?? 0}
                onInput={(v) => props.onPatch({ adjust: { ...s.adjust, rotateDeg: v } })}
              />
              <hr />
              <Slider
                label={t("bright")}
                min={0.5}
                max={1.5}
                step={0.01}
                value={s.tone.brightness}
                onInput={(v) => props.onPatch({ tone: { ...s.tone, brightness: v } })}
              />
              <Slider
                label={t("contrast")}
                min={0.5}
                max={1.5}
                step={0.01}
                value={s.tone.contrast}
                onInput={(v) => props.onPatch({ tone: { ...s.tone, contrast: v } })}
              />
              <button
                type="button"
                class="btn ghost wide"
                onClick={() => props.onPatch({ adjust: { ...NO_ADJUST }, tone: { ...NO_TONE } })}
              >
                {t("resetAdj")}
              </button>
            </div>
          )}

          {tab === "chk" && (
            <ul class="checks">
              <li class="ok">
                <span>✓</span>
                {t("chkSize")} {target.width}×{target.height}px
              </li>
              <li class={s.bg.kind === "transparent" ? "warn" : "ok"}>
                <span>{s.bg.kind === "transparent" ? "!" : "✓"}</span>
                {t("chkBg")}{" "}
                {s.bg.kind === "transparent"
                  ? t("bgTrans")
                  : (s.bg as { color: string }).color.toUpperCase()}
              </li>
              <li class={s.face ? "ok" : "warn"}>
                <span>{s.face ? "✓" : "!"}</span>
                {s.face ? t("chkFace") : t("chkFaceNo")}
              </li>
              {s.matteError && (
                <li class="warn">
                  <span>!</span>
                  {t("needMatte")}
                </li>
              )}
              {kb !== null && (
                <li class={kb <= maxKB ? "ok" : "warn"}>
                  <span>{kb <= maxKB ? "✓" : "!"}</span>
                  {t("chkKB")} {kb}KB / ≤{maxKB}KB
                </li>
              )}
            </ul>
          )}

          <div class="row editfoot">
            <button type="button" class="btn ghost" onClick={props.onBack}>
              {t("backCap")}
            </button>
            <button type="button" class="btn primary" onClick={props.onNext}>
              {t("toExport")}
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}

function customOn(bg: BackgroundOption): boolean {
  return bg.kind === "solid" && !/^#(FFFFFF|438EDB|D9001B)$/i.test(bg.color)
}

function MatteDownNote(props: { t: TFn; onRetry: () => void; busy: boolean }) {
  const { t } = props
  return (
    <div class="matteDown">
      <p class="dim small">{t("needMatte")}</p>
      <button type="button" class="btn ghost" disabled={props.busy} onClick={props.onRetry}>
        {t("retryMatte")}
      </button>
    </div>
  )
}

const thumbs = new Map<string, string>()
/** 1×1 transparent PNG — "original outfit" placeholder. */
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

function thumbFor(id: OutfitId | null): string {
  if (id === null) return TRANSPARENT_PNG
  const cached = thumbs.get(id)
  if (cached) return cached
  const fake: SilhouetteMetrics = {
    bbox: { x0: 16, x1: 144, y0: 8, y1: 160 },
    headW: 44,
    chinY: 66,
    shoulderY: 74,
    shoulderLX: 22,
    shoulderRX: 138,
    outline: null,
    headH: 58,
  }
  const shapes: OutfitShape[] = buildOutfitShapes(id, fake, 160)
  const url = imageToCanvas(renderOutfitLayer(shapes, 160, 160)).toDataURL("image/png")
  thumbs.set(id, url)
  return url
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
      <span class="row spread">
        {props.label}
        <b>{props.value}</b>
      </span>
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

/* ======================================================================
   PAGE 4 · EXPORT
====================================================================== */

interface ExportResults {
  single: { bytes: Uint8Array; quality: number; fits: boolean; kb: number }
  trans: { bytes: Uint8Array; kb: number } | null
  sheet: { bytes: Uint8Array; kb: number; count: number }
}

function ExportPage(props: { t: TFn; session: Session; onRestart: () => void }) {
  const { t, session: s } = props
  const [targetKB, setTargetKB] = useState(s.spec.file.maxKB ?? 200)
  const [results, setResults] = useState<ExportResults | null>(null)
  const target = useMemo(() => specTarget(s.spec), [s.spec])

  useEffect(() => {
    let cancelled = false
    setResults(null)
    ;(async () => {
      const opts = { tone: s.tone, outfit: s.outfit, bg: s.bg, adjust: s.adjust }
      const solid = renderSpecImage(composePortrait(s.source, s, opts), s.face, target, s.adjust)
      const fit = await fitJpegToTargetKB(makeJpegEncoder(solid), targetKB)
      let trans: ExportResults["trans"] = null
      if (s.alpha !== null) {
        const transparent = renderSpecImage(
          composePortrait(s.source, s, { ...opts, bg: { kind: "transparent" as const } }),
          s.face,
          target,
          s.adjust,
        )
        const png = await encodePng(transparent)
        trans = { bytes: png, kb: Math.round(png.byteLength / 1024) }
      }
      const { sheet, count } = layoutPrintSheet(solid)
      const sheetBytes = await makeJpegEncoder(sheet)(0.92)
      if (cancelled) return
      setResults({
        single: {
          bytes: fit.bytes,
          quality: fit.quality,
          fits: fit.fits,
          kb: Math.round(fit.bytes.byteLength / 1024),
        },
        trans,
        sheet: {
          bytes: sheetBytes,
          kb: Math.round(sheetBytes.byteLength / 1024),
          count,
        },
      })
    })().catch((e) => console.error("export failed", e))
    return () => {
      cancelled = true
    }
  }, [s, target, targetKB])

  const slug = s.spec.slug
  const dims = `${s.spec.size.width}x${s.spec.size.height}`

  return (
    <section class="page">
      <div class="pagehead row spread">
        <div>
          <h1>{t("expTitle")}</h1>
          <p class="dim">{t("expSub")}</p>
        </div>
        <button type="button" class="btn ghost" onClick={props.onRestart}>
          {t("restart")}
        </button>
      </div>

      <div class="kbctl">
        <div class="row spread">
          <span>{t("targetKB")}</span>
          <b>
            {targetKB} KB
            {results && (results.single.fits ? ` · ${t("kbFits")}` : ` · ${t("kbOver")}`)}
          </b>
        </div>
        <input
          type="range"
          min={10}
          max={500}
          step={5}
          value={targetKB}
          onInput={(e) => setTargetKB(+e.currentTarget.value)}
        />
        {results && (
          <p class="dim small">
            {t("fmtJpeg")} q{results.single.quality.toFixed(2)} · {results.single.kb}KB
          </p>
        )}
      </div>

      <div class="expgrid">
        <div class="expcard">
          <h3>{t("single")}</h3>
          <p class="dim small">{t("singleD")}</p>
          <div class="pv">
            <Thumb session={s} target={target} bg={s.bg} />
          </div>
          {results && (
            <button
              type="button"
              class="btn primary wide"
              onClick={() =>
                downloadBytes(results.single.bytes, `idphoto_${slug}_${dims}.jpg`, "image/jpeg")
              }
            >
              {t("dlSingle")}
            </button>
          )}
        </div>
        <div class="expcard">
          <h3>{t("trans")}</h3>
          <p class="dim small">{t("transD")}</p>
          <div class="pv checker">
            <Thumb session={s} target={target} bg={{ kind: "transparent" }} />
          </div>
          {results?.trans ? (
            <button
              type="button"
              class="btn ghost wide"
              onClick={() => {
                const trans = results.trans
                if (trans) {
                  downloadBytes(trans.bytes, `idphoto_${slug}_${dims}_alpha.png`, "image/png")
                }
              }}
            >
              {t("dlTrans")}
            </button>
          ) : (
            <p class="dim small">—</p>
          )}
        </div>
        <div class="expcard">
          <h3>{t("sheet")}</h3>
          <p class="dim small">{t("sheetD")}</p>
          <div class="pv">
            <Thumb session={s} target={target} bg={s.bg} sheet />
          </div>
          {results && (
            <>
              <p class="dim small">
                {results.sheet.count} {t("tiles")} · {results.sheet.kb}KB
              </p>
              <button
                type="button"
                class="btn ghost wide"
                onClick={() =>
                  downloadBytes(results.sheet.bytes, `idphoto_${slug}_sheet_6in.jpg`, "image/jpeg")
                }
              >
                {t("dlSheet")}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function Thumb(props: {
  session: Session
  target: CropTarget
  bg: BackgroundOption
  sheet?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { session: s, target, bg, sheet } = props
  useEffect(() => {
    const img0 = renderSpecImage(
      composePortrait(s.source, s, { tone: s.tone, outfit: s.outfit, bg, adjust: s.adjust }),
      s.face,
      target,
      s.adjust,
    )
    const img = sheet ? layoutPrintSheet(img0).sheet : img0
    const canvas = ref.current
    if (!canvas) return
    canvas.width = img.width
    canvas.height = img.height
    canvas
      .getContext("2d")
      ?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  }, [s, target, bg, sheet])
  return <canvas ref={ref} class="thumb" />
}
