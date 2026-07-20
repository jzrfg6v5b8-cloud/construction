FROM python:3.11-slim

ARG INSTALL_OCR=false
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VISION_OUTPUT_DIR=/data/derived

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-base.txt requirements-ocr.txt ./
RUN if [ "$INSTALL_OCR" = "true" ]; then \
        pip install --no-cache-dir -r requirements-ocr.txt; \
    else \
        pip install --no-cache-dir -r requirements-base.txt; \
    fi

COPY vision_worker ./vision_worker
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /data/derived /data/input \
    && chown -R worker:worker /data

USER worker
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]

CMD ["uvicorn", "vision_worker.main:app", "--host", "0.0.0.0", "--port", "8000"]
