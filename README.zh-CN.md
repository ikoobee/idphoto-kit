# idphoto-kit

[![CI](https://github.com/ikoobee/idphoto-kit/actions/workflows/ci.yml/badge.svg)](../../actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-in%20development-orange.svg)](#状态)

**隐私优先的 AI 证件照工具，全部在浏览器本地运行。** 选规格（考试报名 / 证件 / 签证…）→ 换底色 → 自动裁剪达标 → 按目标体积导出——零上传、零服务器、零注册。

> [English README](README.md)

## 状态

**开发中（pre-alpha）**。引擎、规格库与 Web 界面按 v0.1.0 里程碑推进，v0.1.0 发布前存在破坏性变更。

## 为什么做

- **照片不出本机。** 抠图、人脸关键点等全部 AI 推理经 ONNX Runtime Web / MediaPipe 在本地完成——没有服务器，也就无从上传。
- **为考试报名而生。** 国内考试报名（四六级、考研、教资…）对像素尺寸与文件体积（常见 ≤30KB）有硬性要求。idphoto-kit 两者都管：精确裁剪 + 二分压缩 JPEG 到目标体积，且不改动像素尺寸。
- **零部署。** Web 应用是纯静态站；另提供 CLI 与可选的自部署 API 覆盖自动化场景。

## 规划

| 能力 | 目标 |
|---|---|
| 规格库 | 国内标准尺寸 + 考试报名 + 常见签证，版本化 JSON（单一事实源） |
| Web 应用 | 三步流：选规格 → 处理（抠图/换底/裁剪/调整）→ 导出 |
| 引擎 `@idphoto-kit/core` | 纯函数管线：EXIF 矫正 → 人脸关键点 → 抠图 → 换底 → 规格裁剪 → 导出 |
| CLI | `idphoto make --spec cet --bg blue in.jpg` |
| 自部署 API | 可选 FastAPI 服务，高精度抠图档（社区自部署，非云服务） |

抠图模型仅采用宽松许可证（MODNet / BiRefNet；Apache-2.0 / MIT）。

## 开发

环境要求：Node ≥ 20、pnpm ≥ 9。

```bash
pnpm install
pnpm dev      # 本地运行 Web 应用（Vite，http://localhost:5173）
pnpm test     # vitest — core 引擎 + 规格库测试
pnpm lint     # biome
pnpm specs:check  # 规格库校验（zod + 业务规则）
```

当前可用能力：从内置规格库（16 条已核实条目）选规格 → 投入照片（EXIF 方向即时矫正）→ 得到精确尺寸的中心裁剪 JPEG，并实时显示文件体积是否达标。全部本地运行，任何网络请求都不携带图像数据。人脸锚定裁剪（眼线/头占比）、换底色、目标体积压缩将在后续里程碑落地，见 [CHANGELOG](CHANGELOG.md)。

## 参与贡献

按 "inbound = outbound" 惯例接受贡献（详见随首发版补齐的 CONTRIBUTING.md）。规格库数据贡献尤其有价值——每条规格都注明官方来源。

## 许可证

[MIT](LICENSE) © 2026 Ethan (ikoobee)
