# 落地配置清单

按优先级配置。本地开发多数可留空。

## 最短跑通（不用 SketchUp）

1. 打开 http://localhost:3000/projects  
2. 填项目名 → **创建并进入**（会自动 VERIFIED 户型 + 8 张演示场景图）  
3. 到 **方案输出** → **导出 DRAFT** 或 **一键演示 PDF**  

已有项目点列表里的 **一键跑通** 即可。

```bash
cd /Users/lihuaiyuan/Downloads/空调/建材商
cp apps/web/.env.example apps/web/.env.local   # 若还没有
npm install
npm run build -w @sharkflows/processing-queue
npm run dev
```


## 按需环境变量

| 变量 | 作用 |
|------|------|
| `NOTO_CJK_FONT_PATH` | PDF 中文字体；不设则尝试系统字体 |
| `DATABASE_PATH` | SQLite 路径，默认 `.data/sharkflows.sqlite` |
| `RENDERS_PATH` | 场景 PNG 目录，默认 `.data/renders` |
| `SKETCHUP_RESULT_WEBHOOK_SECRET` | 生产 webhook 鉴权（`POST .../sketchup/results`） |
| `VISION_WORKER_URL` | 默认 `http://127.0.0.1:8091`；另开 `npm run dev:vision` |
| `AUTH_SECRET` | 会话签名（上线建议设置） |
| `SIGNED_URL_SECRET` | 私有对象签名 URL |
| `REDIS_URL` | 有则用 BullMQ，无则内存队列 |
| `STRIPE_*` | 计费；不配则演示安全降级 |
| `GOOGLE_CLIENT_*` | Google 登录可选 |
| `OBJECT_STORAGE_*` / `S3_*` | 对象存储；默认本地 `.data/objects` |

## SketchUp / LayOut 本机（支持线上站）

线上站 **不能** 让浏览器直连 `127.0.0.1`。正确做法是 **云队列**：

1. Vercel 已配置 `SKETCHUP_RESULT_WEBHOOK_SECRET`（或 `SKETCHUP_BRIDGE_SECRET`）
2. 本机启动桥接并绑定项目：

```bash
SKETCHUP_CLOUD_URL=https://construction-web-murex.vercel.app \
SKETCHUP_BRIDGE_SECRET=<与 Vercel webhook secret 相同> \
SKETCHUP_PROJECT_ID=prj_你的项目ID \
npm run dev:bridge
```

3. 在线上站打开项目 → SketchUp 页 → **发送到SketchUp**
4. 本机桥接自动 claim → SketchUp 插件建模 → PNG 回传到云端

本地开发仍可用 `http://localhost:3000` 直连桥接（可选）。

## 诚实边界

- **照片级** = SketchUp/外部渲染器出的 PNG，不是网页 3D 截图。
- **LayOut** = 半自动交接 + 三步人工，不是一键全自动 PDF。
- **户型编辑器** = 可交付的墙体 MVP，不是 AutoCAD。
- **线上站 SketchUp** = 云队列 + 本机桥接轮询；浏览器不直连本机。
