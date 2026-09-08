# idphoto-kit

Privacy-first AI ID photo toolkit running entirely in the browser (ONNX Runtime Web / MediaPipe local inference; no uploads, no backend).

## 快速命令

- 安装：`pnpm install`
- 开发：`pnpm dev`（packages/web 落地后可用；当前占位）
- 测试：`pnpm test`（vitest）
- Lint：`pnpm lint`（biome，配置在 biome.json）
- 规格库校验：`pnpm specs:check`（zod + 业务规则，CI 必过）

## 结构导览

- `specs/` — 规格库 JSON + schema（单一事实源，TS/Python 双端共用；每条规格必须有 source 与 checkedAt）
- `packages/specs-ts` — TS 读取器 + zod 校验器（T1.2）
- `packages/core` — 处理管线纯函数（EXIF→人脸→抠图→换底→裁剪→导出；不依赖 DOM/IO）（T1.4+）
- `packages/web` — 浏览器应用（Preact + Vite）（T1.10+）
- `packages/cli` — 命令行工具（T1.15）
- `server/` — 可选自部署 API（Python FastAPI，M2；官方不运营）
- `docs/` — ADR 与录入指南

## 本项目专属约定

- **模型红线**：仅允许 Apache-2.0 / MIT 模型（当前白名单 MODNet、MediaPipe、BiRefNet、RetinaFace）；RMBG 系列（bria 许可）禁止引入。模型文件不入 git（.gitignore 已拦），经 Release Assets 分发。
- **core 纯函数纪律**：core 不 import 浏览器/Node API；图像数据用自描述结构（ImageData 兼容），保证 web/cli/测试三端复用。
- **规格数据纪律**：`specs/*.json` 每条必含 `source.url` 与 `checkedAt`；考试规格每年报名季复查。UI 呈现时附「以报名系统最终要求为准」提示。
- **隐私红线**：浏览器端不得发起任何携带图像数据的网络请求；模型经 Release Assets URL 拉取（仅下模型，不发数据）。
- **CI 占位说明**：dev/build 仍为占位（T1.10 替换）；lint=biome、test=vitest、specs:check 已为真实命令。
- 验证纪律：本地跑检查命令显式看退出码，禁止 tail 截断输出（工作区既有约定）。
