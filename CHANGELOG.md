# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: MIT license, bilingual README, CI skeleton, pnpm workspace layout (`specs/`, `packages/`, `docs/`).
- Placeholder `lint` / `test` scripts (exit 0) to keep CI green until real tooling lands in T1.2; replaced then.
- Spec library v0: `specs/schema.json` (JSON Schema mirror) + 8 verified seed specs (CN standard sizes, CET-4/6, social-security card, US/Japan visa) with per-entry official `source` and `checkedAt`.
- `@idphoto-kit/specs` package: zod schema, loader, business-rule checks (unique slugs, fresh `checkedAt`, `maxKB`⇒jpg, sane head-height ratios), `specs:check` CI gate, 11 vitest cases.
- Real tooling: biome (lint/format) and vitest replace the placeholder scripts.

[Unreleased]: https://github.com/ikoobee/idphoto-kit/compare/v0.0.0...HEAD
