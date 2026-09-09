# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: MIT license, bilingual README, CI skeleton, pnpm workspace layout (`specs/`, `packages/`, `docs/`).
- Placeholder `lint` / `test` scripts (exit 0) to keep CI green until real tooling lands in T1.2; replaced then.
- Spec library v0: `specs/schema.json` (JSON Schema mirror) + 8 verified seed specs (CN standard sizes, CET-4/6, social-security card, US/Japan visa) with per-entry official `source` and `checkedAt`.
- Spec library v0.1 (T1.3): 16 verified entries — added postgrad (480×640/200KB), NTCE teacher cert (300×400/200KB), civil service (≥295×413/100KB), NCRE (295×413/200KB), legal professional exam (413×626/40–100KB incl. lower bound), Putonghua (390×567/80KB), PRC passport digital (390×567, head-height 28–33mm), resume (convention). Every entry cites its official source.
- `@idphoto-kit/specs` package: zod schema, loader, business-rule checks (unique slugs, fresh `checkedAt`, `maxKB`⇒jpg, sane head-height ratios), `specs:check` CI gate, 11 vitest cases.
- Real tooling: biome (lint/format) and vitest replace the placeholder scripts.
- `@idphoto-kit/core` base layer (T1.4): self-describing `RgbaImage` type (ImageData-compatible, zero DOM deps), hand-rolled JPEG EXIF orientation reader, `applyOrientation` (8 orientations), flip/rotate/transpose/crop, and premultiplied-alpha bilinear resize (avoids hair-edge color bleed); 17 unit tests.
- Face-anchored spec cropping (T1.5): `FaceLandmarks` adapter contract (eyes center / eye-line roll / head top / chin), `planCrop` geometry (counter-roll, head-height ratio midpoint scaling, eye-line placement, upscale & large-roll warnings) and `renderToSpec` inverse-mapped premultiplied sampler with edge-clamped background extension; 9 marker-based tests.
- `@idphoto-kit/web` minimal app: `pnpm dev` now actually runs — Vite + Preact, spec cards from the live `/specs` library (via a new browser-safe `@idphoto-kit/specs/browser` entry), photo upload with EXIF orientation correction (core), center-crop placeholder to exact spec pixels, live KB readout vs. the spec cap. CI gains a build step.
- Matting pipeline (T1.6): `MattingModel` adapter contract + `refineAlpha` edge post-processing in core (smoothstep band narrowing [0.35, 0.65] default + transition-band feather); MODNet ONNX adapter in web with pure tensor pre/post-processing (512×512 CHW, ±1 normalization, bilinear alpha upscale) and lazy onnxruntime-web import. Model asset upload (Release `models-v0`) pending.
- Background compositing (T1.7): `composeBackground` over `BackgroundOption` — transparent (straight-alpha PNG), solid color, vertical/horizontal gradient (reserved for specs that require it); `parseHexColor` guard; 8 blend-accuracy tests.
- Target-size export (T1.8): `fitJpegToTargetKB` bisection over an injected encoder (quality is the only lever — pixel dimensions never change); quality-first ceiling shortcut, floor fallback with explicit `fits: false`; browser canvas encoder factory + PNG export + download helper in web; 5 tests against a deterministic size(q) model.
- Print layout (T1.9): `layoutPrintSheet` tiles a portrait on a 6-inch 1800×1200 sheet with balanced-gutter column selection (1-inch lands on the classic 4×2 = 8), white background, dashed cut guides, oversize rejection; 6 tests incl. cluster-position verification.
- Processing page (T1.11/T1.13): real face-anchored cropping in the browser via the MediaPipe FaceLandmarker adapter (landmark 33/263 eye anchor + roll, 10/152 head height, GPU→CPU delegate fallback); fine-tune sliders (zoom / pan / rotate) layered on the crop plan via `CropAdjust`; live checklist (size, face anchor, plan warnings, EXIF fix, KB vs cap); IndexedDB model-bytes cache wired into `ModnetOnnx` (session from cached bytes); background-swap panel honestly marked pending until the model asset ships.

[Unreleased]: https://github.com/ikoobee/idphoto-kit/compare/v0.0.0...HEAD
