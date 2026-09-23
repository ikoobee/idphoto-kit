# Model assets: conversion, distribution, fallback chain

The app performs every inference locally; the only network traffic it ever
initiates is **downloading model weights**. Weights are distributed outside git.

## Manifest chain (`packages/web/src/models/manifest.ts`)

| Order | Source | URL | When it wins |
|---|---|---|---|
| 1 | local drop-in | `/models/<file>` (served from `packages/web/public/models/`) | dev machines, self-hosts, offline |
| 2 | Release Assets | `https://github.com/ikoobee/idphoto-kit/releases/download/models-v0/<file>` | the hosted static site |

Failures cascade with full per-source reporting; the UI degrades to a notice +
retry when all sources fail. Two hardening details in `model-cache.ts`:

- Entries cache in IndexedDB **by model id**, not URL — reordering or adding
  mirrors never triggers a re-download.
- SPA hosts answer unknown paths with `index.html` + HTTP 200; the loader
  rejects `text/html` responses so a misrouted URL can't poison the runtime.

## Whitelist (license discipline)

Only Apache-2.0 / MIT weights are allowed: **MODNet** (matting), **MediaPipe**
(face landmarks), later BiRefNet (server tier). RMBG-family (bria license) is
explicitly banned.

## Maintainer release procedure (models-v0)

1. Export + quantize MODNet to `modnet-ppm-512-int8.onnx` (see conversion notes
   below), verify it runs: place it in `packages/web/public/models/` and run
   `pnpm dev` → the edit page's background swatches should activate.
2. Draft a GitHub release tagged `models-v0`, attach the `.onnx` file.
3. Sanity-check from the deployed site (DevTools → Network: model fetch 200,
   `application/octet-stream`).
4. Bump nothing in code — the manifest already points at `models-v0`.

## Conversion sketch (MODNet → ONNX int8)

Upstream provides PyTorch weights (`zhengke9611/MODNet`, Apache-2.0). Export
the backbone with a fixed 512×512 input (dynamic batch), then quantize:

```
python -m onnxruntime.quantization.preprocess --input modnet.onnx --output modnet.pre.onnx
python -c "from onnxruntime.quantization import quantize_dynamic; \
  quantize_dynamic('modnet.pre.onnx', 'modnet-ppm-512-int8.onnx', weight_type=QuantType.QUInt8)"
```

Validate with the tensor plumbing covered by
`packages/web/test/modnet-tensor.test.ts` (input packing / alpha unpacking are
unit-tested against the expected layout).
