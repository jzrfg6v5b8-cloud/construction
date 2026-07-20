from __future__ import annotations

import asyncio

from fastapi import FastAPI

from .classification import classify
from .models import (
    Classification,
    ClassifyRequest,
    HealthResponse,
    JobRequest,
    JobResult,
)
from .ocr import backend_name
from .pipeline import run_job

app = FastAPI(
    title="Vision Worker",
    version="1.0.0",
    description=(
        "Conservative document/image preprocessing and candidate extraction. "
        "All machine outputs require review and are never VERIFIED."
    ),
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", ocr_backend=backend_name())


@app.post("/v1/jobs", response_model=JobResult)
async def create_job(request: JobRequest) -> JobResult:
    # OpenCV, PDF rasterization, and OCR are blocking CPU work.
    return await asyncio.to_thread(run_job, request)


@app.post("/v1/classify", response_model=Classification)
def classify_asset(request: ClassifyRequest) -> Classification:
    """Classify product/material/site/procurement metadata with a disclosed heuristic."""
    return classify(request)
