from __future__ import annotations

import base64
import binascii
import os
from pathlib import Path
from typing import Iterator

import fitz

from .image_processing import decode_image, preprocess_image, sha256_bytes, write_derived_image
from .models import JobRequest, JobResult, PageResult
from .ocr import recognize


def run_job(request: JobRequest) -> JobResult:
    try:
        source_data = _read_source(request)
    except Exception as exc:
        return JobResult(
            job_id=request.job_id,
            status="failed",
            source_sha256="",
            errors=[f"source read failed: {type(exc).__name__}: {exc}"],
        )

    source_hash = sha256_bytes(source_data)
    pages: list[PageResult] = []
    errors: list[str] = []
    try:
        page_stream = _iter_pages(source_data, request.source.filename, request.source.media_type, request.options.raster_dpi)
        for page_index, page_bytes, page_error in page_stream:
            if page_error:
                pages.append(
                    PageResult(
                        page_index=page_index,
                        width=0,
                        height=0,
                        sha256="",
                        error=page_error,
                    )
                )
                continue
            assert page_bytes is not None
            pages.append(_process_page(request, source_hash, page_index, page_bytes))
    except Exception as exc:
        errors.append(f"document conversion failed: {type(exc).__name__}: {exc}")

    page_failures = [page for page in pages if page.error]
    if errors or (pages and len(page_failures) == len(pages)):
        status = "failed"
    elif page_failures:
        status = "partial"
    elif pages:
        status = "succeeded"
    else:
        status = "failed"
        errors.append("document produced no pages")
    return JobResult(
        job_id=request.job_id,
        status=status,
        source_sha256=source_hash,
        pages=pages,
        errors=errors,
    )


def _read_source(request: JobRequest) -> bytes:
    source = request.source
    if source.data_base64 is not None:
        try:
            return base64.b64decode(source.data_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("dataBase64 is not valid base64") from exc
    assert source.path is not None
    allowed_root = os.getenv("VISION_INPUT_ROOT")
    path = Path(source.path).expanduser().resolve()
    if allowed_root:
        root = Path(allowed_root).expanduser().resolve()
        if not path.is_relative_to(root):
            raise PermissionError(f"path must be under VISION_INPUT_ROOT ({root})")
    return path.read_bytes()


def _iter_pages(
    data: bytes, filename: str, media_type: str | None, dpi: int
) -> Iterator[tuple[int, bytes | None, str | None]]:
    is_pdf = (media_type or "").lower() == "application/pdf" or filename.lower().endswith(".pdf")
    if not is_pdf:
        yield 0, data, None
        return

    with fitz.open(stream=data, filetype="pdf") as document:
        scale = dpi / 72
        matrix = fitz.Matrix(scale, scale)
        for index in range(document.page_count):
            try:
                pixmap = document.load_page(index).get_pixmap(matrix=matrix, alpha=False)
                yield index, pixmap.tobytes("png"), None
            except Exception as exc:
                yield index, None, f"PDF page rasterization failed: {type(exc).__name__}: {exc}"


def _process_page(request: JobRequest, source_hash: str, page_index: int, page_bytes: bytes) -> PageResult:
    page_hash = sha256_bytes(page_bytes)
    try:
        image = decode_image(page_bytes)
        processed = preprocess_image(image)
        text_candidates, ocr_warnings = recognize(processed.color, request.options.ocr_mode)
        derived_files: list[str] = []
        if request.options.save_derived_files:
            output_root = Path(request.options.output_dir or os.getenv("VISION_OUTPUT_DIR", "/tmp/vision-worker"))
            job_root = output_root / f"{request.job_id}-{source_hash[:12]}"
            color_path = job_root / f"page-{page_index:04d}-normalized.png"
            binary_path = job_root / f"page-{page_index:04d}-binary.png"
            write_derived_image(color_path, processed.color)
            write_derived_image(binary_path, processed.binary)
            derived_files = [str(color_path), str(binary_path)]
        return PageResult(
            page_index=page_index,
            width=int(processed.color.shape[1]),
            height=int(processed.color.shape[0]),
            sha256=page_hash,
            derived_files=derived_files,
            candidates=[*processed.candidates, *text_candidates],
            warnings=[*processed.warnings, *ocr_warnings],
        )
    except Exception as exc:
        return PageResult(
            page_index=page_index,
            width=0,
            height=0,
            sha256=page_hash,
            error=f"{type(exc).__name__}: {exc}",
        )
