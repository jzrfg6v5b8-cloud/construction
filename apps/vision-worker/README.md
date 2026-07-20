# Vision Worker

独立的 FastAPI 服务，负责：

- OpenCV 图像预处理（纠偏、去噪、对比度、线段/墙体候选）
- HEIC → JPEG/PNG 转换（`pillow-heif`）
- PDF 逐页栅格化（PyMuPDF）
- 可选 PaddleOCR（`requirements-ocr.txt`）

机器输出一律为候选，**不会**写入 `VERIFIED`，也不声称照片级识别准确率。

## 启动（默认端口 8091）

与 Web 客户端默认 `VISION_WORKER_URL=http://127.0.0.1:8091` 对齐：

```bash
# 仓库根目录
npm run dev:vision

# 或手动
cd apps/vision-worker
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-base.txt
# 可选真实 OCR（体积大，未安装时 ocr_backend=unavailable）：
# pip install -r requirements-ocr.txt
uvicorn vision_worker.main:app --host 127.0.0.1 --port 8091
```

健康检查：

```bash
curl -s http://127.0.0.1:8091/health
```

示例请求见 `examples/job-request.sample.json`：

```bash
curl -s http://127.0.0.1:8091/v1/jobs \
  -H 'content-type: application/json' \
  -d @examples/job-request.sample.json
```

## Web 接入

| 环境变量 | 默认 |
|----------|------|
| `VISION_WORKER_URL` | `http://127.0.0.1:8091` |

| API | 行为 |
|-----|------|
| `GET /api/projects/[id]/vision/jobs` | 探测 Worker；不可达 → **503** |
| `POST /api/projects/[id]/vision/jobs` | 转发 `/v1/jobs`；不可达 → **503**，**不编造 OCR** |

## Docker

```bash
docker build -t sharkflows-vision-worker apps/vision-worker
# 可选 OCR：docker build --build-arg INSTALL_OCR=true ...
docker run --rm -p 8091:8000 sharkflows-vision-worker
```

## 诚实边界

- 未安装 `paddleocr` 时，`ocrBackend` 为 `unavailable`，回退启发式/空候选。
- Worker 宕机时 Web 返回 503，响应中不会出现伪造 OCR 字段。
- 不提供照片级渲染；场景效果图由非照片级截图/占位或外部渲染器负责。
