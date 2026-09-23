# Local model drop-in (dev / self-host)

Model weights are **never committed** (`.gitignore`: `*.onnx`). Place them here
to run the matting pipeline without any network:

```
packages/web/public/models/
└── modnet-ppm-512-int8.onnx      # MODNet, 512 input, int8 quantized (~25MB)
```

Vite serves `public/` at the site root, so the app finds the file at
`/models/modnet-ppm-512-int8.onnx` — the first source in the manifest chain
(`src/models/manifest.ts`). Without a local copy the app falls back to the
GitHub Release Assets URL; if that also fails, background swap and outfit
patching degrade gracefully (the face-anchored crop keeps working).

## Obtaining the weights

MODNet is Apache-2.0 licensed (model whitelist: `CLAUDE.md` / `docs/models.md`).
Any int8-quantized ONNX export with a 512×512 RGBA input and single-channel
alpha output works; see `docs/models.md` for the conversion notes and the
Release upload procedure (maintainers).
