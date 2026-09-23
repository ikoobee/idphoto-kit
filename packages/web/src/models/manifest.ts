import { cachedModelBytes } from "./model-cache.ts"

/**
 * Model distribution manifest. Weights are never committed (repo size /
 * release hygiene); they resolve through a source chain so every environment
 * gets the best available copy:
 *
 *   1. local  — packages/web/public/models/<file> (dev drop-in, self-host)
 *   2. release— GitHub Release Assets (models-v0)
 *
 * Only the model bytes travel — no image data is ever sent anywhere.
 */
export interface ModelSource {
  url: string
  label: string
}

export interface ModelManifest {
  key: string
  file: string
  sources: ModelSource[]
}

export const MODNET_MANIFEST: ModelManifest = {
  key: "modnet-ppm-512-int8",
  file: "modnet-ppm-512-int8.onnx",
  sources: [
    { url: "/models/modnet-ppm-512-int8.onnx", label: "local" },
    {
      url: "https://github.com/ikoobee/idphoto-kit/releases/download/models-v0/modnet-ppm-512-int8.onnx",
      label: "release",
    },
  ],
}

/** Try each source in order; report every failure when none works. */
export async function fetchModelBytes(manifest: ModelManifest): Promise<Uint8Array> {
  const failures: string[] = []
  for (const source of manifest.sources) {
    try {
      return await cachedModelBytes(source.url, manifest.key)
    } catch (e) {
      failures.push(`${source.label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`model "${manifest.key}" unavailable (${failures.join(" · ")})`)
}
