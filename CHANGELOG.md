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

[Unreleased]: https://github.com/ikoobee/idphoto-kit/compare/v0.0.0...HEAD
