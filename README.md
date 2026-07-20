# Sharkflows Space Configurator

从户型图、现场照片和采购资料建立可追溯资产，经过视觉候选、DeepSeek 结构化推理及人工审核，生成同一方案版本下的平面图、空间组图、采购清单、BOM 与 PDF。

现在同时提供真实的 SketchUp Ruby Extension、本地回环桥接和 LayOut 交接协议。SketchUp 模型由插件调用官方 Ruby API 创建，不以 Three.js 画面冒充 SKP 模型或 LayOut 输出。

## Monorepo

```text
apps/web                    Sharkflows Next.js 网页
apps/vision-worker          Python FastAPI OCR/视觉候选 Worker（Paddle 可选）
apps/sketchup-extension     SketchUp Ruby Extension
packages/space-schema       共享 TypeScript、Zod 与 JSON Schema 协议
packages/sketchup-export    仅监听 127.0.0.1 的本地建模任务桥接
packages/processing-queue   资产处理队列（Local 内存 / BullMQ+Redis 双模式）
templates/layout            LayOut 模板清单、视口约定与 A03023 交接样例
docs/sketchup-integration   安装、开发、同步、验收和故障恢复文档
```

> 当前是可运行的阶段性实现。演示数据会明确标记为候选或 Demo。**未宣称照片级渲染已完成**；未部署 Paddle 时不会伪造中文 OCR；FINAL PDF 仅在 `FinalApprovalService` 通过后导出。

## 启动与检查

```bash
cp apps/web/.env.example apps/web/.env.local
npm install
npm run build -w @sharkflows/processing-queue   # 首次或队列包变更后
npm run dev
```

可选：启动视觉 Worker（默认 Web 客户端地址 `http://127.0.0.1:8091`）：

```bash
npm run dev:vision
# 或见 apps/vision-worker/README.md
```

打开 <http://localhost:3000>。质量检查：

```bash
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

SketchUp 相关开发命令：

```bash
npm run dev:bridge
# 终端会输出随机 Token；地址默认 http://127.0.0.1:43821
npm run test:ruby
```

## 诚实边界（当前阶段）

| 能力 | 状态 |
|------|------|
| 户型几何编辑 | **已落地 MVP**：`/projects/[id]/calibration` 2D 墙体编辑 → SQLite → SketchUp SpaceConfiguration。 |
| 照片级 / 写实渲染 | **不走浏览器假装**。落地路径：SketchUp 场景 PNG → `/api/projects/.../renders` → PDF 嵌入。 |
| LayOut | **三步人工清单**落库（打开模板 / 刷新引用 / 导出），不做全自动假承诺。 |
| PaddleOCR | **可选**。Worker 不可达时返回 **503**，不编造 OCR。 |
| FINAL 方案 PDF | 仅 `FinalApprovalService` 全部通过；需 CJK 字体。 |

## 你需要配置什么

```bash
cp apps/web/.env.example apps/web/.env.local
npm install
npm run build -w @sharkflows/processing-queue
npm run dev
```

打开 <http://localhost:3000/projects> 新建项目，按：**户型校准 → SketchUp → 方案输出**。

| 配置项 | 何时需要 |
|--------|----------|
| `NOTO_CJK_FONT_PATH` | 导出 PDF（或装系统 CJK 字体让其自动回退） |
| `SKETCHUP_RESULT_WEBHOOK_SECRET` | 生产环境插件/桥接 POST 结果 webhook |
| `RENDERS_PATH` | 自定义场景 PNG 目录（默认 `.data/renders`） |
| `VISION_WORKER_URL` + `npm run dev:vision` | 要真实 OCR 时 |
| `npm run dev:bridge` + `/settings/sketchup` Token | SketchUp 本机建模 |
| SketchUp Pro + 扩展 + 公司 `.layout` 模板 | 真建模 / LayOut 导出 |
| `AUTH_SECRET` / Stripe / Redis / S3 | 上线认证、计费、队列、对象存储时 |

本机最短路径（无 SketchUp 也能验 PDF）：户型点 VERIFIED → 方案页上传 8 张 PNG → 导出 DRAFT。


## SketchUp＋LayOut 工作流

1. Web 端在 `/projects/demo/sketchup` 导出经 `@sharkflows/space-schema` 验证的 A03023 `SpaceConfiguration`。
2. 可下载 JSON 后在插件中选择“导入本地 JSON”，或在 `/settings/sketchup` 填入本机桥接地址和随机 Token。
3. Web 浏览器向桥接创建幂等任务；插件主动从 `/v1/plugin/tasks/next` 拉取，网页不能直接控制 SketchUp。
4. 插件把公开协议转换为内部建模记录，以稳定 UUID 查找对象。既有对象在原实例/组上更新；删除前核对对象的 `projectId`。
5. 外墙、固定区域、厨房、浴室相关设备会锁定；低置信度或未审核尺寸不能覆盖模型中已标记 `VERIFIED` 的尺寸。
6. 插件创建墙体厚度/高度、门窗洞口、轻质隔墙、受尺寸上下限保护的参数化组件，并写入 SKU、项目 ID、对象 ID、材料码和审核状态。
7. 插件创建“平面、尺寸平面、鸟瞰、客厅、主卧、次卧、厨房、浴室”场景；尺寸使用 SketchUp 关联尺寸实体，不烘焙进渲染图。
8. 本地导出 SKP、各场景 PNG、详细 SKU 统计 JSON 和 LayOut handoff manifest；桥接回传状态、版本、SKU 数量与交接文件。
9. Sharkflows 比较 BOM、SketchUp `skuCounts` 和报价数量。任何差异都产生阻止 FINAL 的错误。

任务状态严格为：

```text
QUEUED → DOWNLOADED → MODEL_BUILDING → MODEL_VALIDATING
→ LAYOUT_REFRESH_REQUIRED → EXPORTING → COMPLETED
```

任何阶段均可进入 `FAILED`，错误会保留代码、消息和可重试状态。

### 安装 SketchUp Extension

开发安装说明见 `docs/sketchup-integration/installation-and-usage.md`。扩展入口文件为 `apps/sketchup-extension/jiancai_space.rb`。开发时可将该文件和 `jiancai_space/` 复制到 SketchUp Plugins 目录；发布时应打包为 RBZ 并通过 Extension Manager 安装。

示例组件库位于 `apps/sketchup-extension/jiancai_space/components/manifest.json`。仓库不包含冒充厂家产品的二进制 SKP；缺失时由 Ruby 按真实毫米和最小/最大限制生成明确标注的参数化占位体。没有使用或声称支持 SketchUp Dynamic Components。

### LayOut 真实限制

SketchUp Ruby Extension 不能被描述为能够可靠地全自动控制独立 LayOut 应用。仓库因此只自动准备方案版本化 SKP、标准场景、关联尺寸、场景 PNG、组件统计与 LayOut handoff manifest。实际交付仍需人工打开模板、刷新引用并导出 PDF/PNG。完整流程见 `templates/layout/README.md` 与 `docs/sketchup-integration/README.md`。

本阶段不包含 Revit 插件。未来 Revit 适配必须复用 `SpaceConfiguration`、Product/SKU、Material、BOM 和 `ModelExportResult` 协议。

## Vision Worker

`apps/vision-worker` 提供 OpenCV 预处理、可选 PaddleOCR、PDF 逐页栅格化与 HEIC 转换。Web 通过：

- 环境变量 `VISION_WORKER_URL`（默认 `http://127.0.0.1:8091`）
- API `POST/GET /api/projects/[id]/vision/jobs`

Worker 不可用时返回 503，响应中不会出现伪造的 OCR 字段。详见 `apps/vision-worker/README.md`。

## 处理队列双模式

```ts
import { createQueueAdapter } from "@sharkflows/processing-queue";
// REDIS_URL 为空 → LocalQueueAdapter（进程内）
// REDIS_URL 已设 → BullMqQueueAdapter
const queue = createQueueAdapter();
```

本地开发无需 Redis；生产可切换到 BullMQ 而不改业务状态机。

## DeepSeek 的职责

`DeepSeekProvider` 使用 OpenAI 兼容格式，Base URL 默认为 `https://api.deepseek.com`。默认模型为 `deepseek-v4-flash`，复杂尺寸协调可切换到 `deepseek-v4-pro`。所有结果先经过 Zod 校验；超时、HTTP 错误或非法 JSON 不会被写成正式业务数据。没有 API Key 时使用确定性的 `MockDeepSeekProvider`。

DeepSeek 负责整理 OCR/视觉候选、解释尺寸矛盾、合并商品资料、推荐布局与方案文案。不负责确认最终尺寸、结构安全、消防合规或施工可行性，也不能伪造 SKU/价格或把低置信度候选升级为已审核数据。

原始客户图片默认不会发送给 DeepSeek。

```dotenv
DEEPSEEK_API_KEY=从服务端环境注入
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-flash
DEEPSEEK_COMPLEX_MODEL=deepseek-v4-pro
VISION_WORKER_URL=http://127.0.0.1:8091
NOTO_CJK_FONT_PATH=/path/to/NotoSansSC-Regular.otf
REDIS_URL=
```

## 使用流程

1. 打开 <http://localhost:3000/projects>，**新建项目**（或进入预置 `demo`）。
2. 在素材库批量上传 JPG/PNG/WEBP/PDF/CSV/XLSX；列表来自 SQLite，不是假数据。
3. 户型校准 / 采购页复用同一素材库（按用途筛选上传）。
4. 场景页展示本项目真实图片素材；SketchUp 同步仍走本机桥接。
5. 方案页可导出 DRAFT PDF，写入审批后尝试 FINAL（门禁未过会返回 409）。

可选：另开终端 `npm run dev:vision` 做真实 OCR；不启动时文件仍会保存。

## 材料纹理与颜色

材料原图保留不动。压缩图不能用于颜色确认；最终材料以签字确认的实物样板为准。

## 图片不能替代复尺

像素到毫米映射依赖可信比例或人工确认的尺寸链。缺少可靠尺寸的商品不能参与精确碰撞，也不能标记为可施工。

## 会员、支付与登录

- 邮箱注册/登录写入 SQLite 会话（`sf_session` Cookie）。
- Google OAuth 在配置 `GOOGLE_CLIENT_ID/SECRET` 后可用，否则返回 503。
- Stripe Checkout/Portal 未配置密钥时返回 mock；Webhook 需 `STRIPE_WEBHOOK_SECRET`，事件幂等写入 `stripe_events` 并更新订阅。

简体中文、繁體中文和 English 通过 `LanguageSwitcher`（首页、AppShell、登录、定价）实时切换。

## 隐私与存储

- SQLite 默认 `.data/sharkflows.sqlite`；
- 对象存储默认本地 `.data/objects` / `.data/private`；配置 S3 环境变量后切 `S3ObjectStorage`；
- 文件访问使用短时效签名 Token。

## 当前限制

- Vision Worker 需 `npm run dev:vision`（或等价 uvicorn）；PaddleOCR 为可选依赖。
- Three.js / canvas 场景为**非照片级**结构示意；SketchUp 场景 PNG 可嵌入 PDF，照片级外部渲染器未宣称完成。
- 未设 `REDIS_URL` 时用进程内 Local 队列；设了则用 BullMQ。
- FINAL PDF 需审批门禁；开发可用 `?forceDemoFinal=1` 演示，生产禁用。
- LayOut 仍为三个明确人工步骤，不会伪造自动 LayOut PDF。
