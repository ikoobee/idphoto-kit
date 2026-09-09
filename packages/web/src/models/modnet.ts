import { type AlphaMat, type MattingModel, type RgbaImage, refineAlpha } from "@idphoto-kit/core"
import { alphaFromModnetOutput, buildModnetInput, MODNET_INPUT_SIZE } from "./modnet-tensor.ts"

/**
 * MODNet portrait matting via ONNX Runtime Web. The model file (~int8) is
 * fetched lazily from the Release Assets URL — no image data ever leaves the
 * browser; the fetch carries only the model download.
 *
 * NOTE: the URL below is the planned models-v0 release asset. Until the model
 * is uploaded this adapter cannot run; wiring the UI to it happens in the
 * processing-page milestone regardless.
 */
export const DEFAULT_MODNET_URL =
  "https://github.com/ikoobee/idphoto-kit/releases/download/models-v0/modnet-ppm-512-int8.onnx"

export interface ModnetOptions {
  url?: string
}

export class ModnetOnnx implements MattingModel {
  private session: Promise<InferenceSessionLike> | null = null

  constructor(private readonly opts: ModnetOptions = {}) {}

  private async load(): Promise<InferenceSessionLike> {
    this.session ??= (async () => {
      const ort = await import("onnxruntime-web")
      return ort.InferenceSession.create(this.opts.url ?? DEFAULT_MODNET_URL)
    })()
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
