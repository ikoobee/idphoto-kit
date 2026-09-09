# idphoto-kit

[![CI](https://github.com/ikoobee/idphoto-kit/actions/workflows/ci.yml/badge.svg)](../../actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-in%20development-orange.svg)](#status)

**Privacy-first AI ID photo toolkit that runs entirely in your browser.** Pick a spec (exam registration, ID card, visa…), swap the background, auto-crop to compliance, and export with a target file size — no uploads, no server, no sign-up.

> [中文说明](README.zh-CN.md)

## Status

**In active development (pre-alpha).** The engine, spec library, and web UI are being built per the v0.1.0 milestone. Expect rough edges and breaking changes until v0.1.0 is tagged.

## Why

- **Your photos never leave your device.** All AI inference (matting, face landmarks) runs locally via ONNX Runtime Web / MediaPipe. Nothing is uploaded — there is no server to upload to.
- **Exam-friendly specs.** Chinese exam registrations (CET-4/6, postgrad, teacher certification…) require exact pixel sizes *and* file-size caps (often ≤30KB). idphoto-kit targets both: exact crop + binary-search JPEG compression to fit the limit without changing pixel dimensions.
- **Zero deployment.** The web app is a static site. The CLI and an optional self-hosted API cover automation use cases.

## Plan

| Capability | Target |
|---|---|
| Spec library | CN standard sizes + exam registrations + common visas, as versioned JSON (single source of truth) |
| Web app | 3-step flow: pick spec → process (matting / background / crop / adjust) → export |
| Engine (`@idphoto-kit/core`) | Pure-function pipeline: EXIF fix → face landmarks → matting → background → spec crop → export |
| CLI | `idphoto make --spec cet --bg blue in.jpg` |
| Self-host API | Optional FastAPI service with high-precision matting (community-run, not a cloud service) |

Matting models are permissively licensed only (MODNet / BiRefNet; Apache-2.0 / MIT).

## Development

Prerequisites: Node ≥ 20, pnpm ≥ 9.

```bash
pnpm install
pnpm dev      # run the web app locally (Vite, http://localhost:5173)
pnpm test     # vitest — core engine + spec library
pnpm lint     # biome
pnpm specs:check  # validate the spec library (zod + business rules)
```

What works today: pick a spec from the built-in library (16 verified entries), drop in a photo
(EXIF orientation corrected on the fly), get a center-cropped, exactly-sized JPEG with a live
KB readout against the spec's size cap. Everything runs locally — no network calls carry image
data. Face-anchored alignment (eye line / head-height ratio), background swap, and target-KB
compression land in the upcoming milestones; see [CHANGELOG](CHANGELOG.md).

## Contributing

Contributions are welcome under the "inbound = outbound" convention (details in CONTRIBUTING.md, coming with the first release). Spec-library data contributions are especially valuable — every spec entry cites its official source.

## License

[MIT](LICENSE) © 2026 Ethan (ikoobee)
