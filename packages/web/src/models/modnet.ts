import { type AlphaMat, type MattingModel, type RgbaImage, refineAlpha } from "@idphoto-kit/core"
import { fetchModelBytes, MODNET_MANIFEST } from "./manifest.ts"
import { alphaFromModnetOutput, buildModnetInput, MODNET_INPUT_SIZE } from "./modnet-tensor.ts"

/**
 * MODNet portrait matting via ONNX Runtime Web. Model bytes resolve through
 * the manifest source chain (local drop-in → Release Assets) and cache in
 * IndexedDB — no image data ever leaves the browser; the fetch carries only
 * the model download.
 */
export class ModnetOnnx implements MattingModel {
  private session: Promise<InferenceSessionLike> | null = null

  /** Drop a failed load so a user-triggered retry starts clean. */
  reset(): void {
    this.session = null
  }

  private async load(): Promise<InferenceSessionLike> {
    this.session ??= (async () => {
      const ort = await import("onnxruntime-web")
      const bytes = await fetchModelBytes(MODNET_MANIFEST)
      return ort.InferenceSession.create(bytes)
    })()
    // A rejected promise would otherwise be cached forever — clear it so the
    // next call (or an explicit reset) retries the source chain.
    this.session.catch(() => {
      this.session = null
    })
    return this.session
  }

  async matte(input: RgbaImage): Promise<AlphaMat> {
    const session = await this.load()
    const ort = await import("onnxruntime-web")
    const { data, dims } = buildModnetInput(input, MODNET_INPUT_SIZE)
    const tensor = new ort.Tensor("float32", data, dims)

    const inputName = session.inputNames[0]
    const outputName = session.outputNames[0]
    if (!inputName || !outputName) throw new Error("MODNet session has no I/O names")
    const results = await session.run({ [inputName]: tensor })
    const output = results[outputName]
    if (!output) throw new Error(`MODNet output '${outputName}' missing`)

    const raw = alphaFromModnetOutput(
      output.data as Float32Array,
      MODNET_INPUT_SIZE,
      input.width,
      input.height,
    )
    return refineAlpha(raw, input.width, input.height)
  }
}

/** Structural subset of ort.InferenceSession — avoids importing types eagerly. */
interface InferenceSessionLike {
  inputNames: string[]
  outputNames: string[]
  run(feeds: Record<string, unknown>): Promise<Map<string, { data: unknown }>>
}
