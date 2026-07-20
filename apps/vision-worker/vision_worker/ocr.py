from __future__ import annotations

from functools import lru_cache
from typing import Any

import numpy as np

from .models import BBox, RecognitionCandidate, ReviewStatus

try:
    from paddleocr import PaddleOCR

    PADDLE_AVAILABLE = True
except ImportError:
    PaddleOCR = None  # type: ignore[assignment]
    PADDLE_AVAILABLE = False


def backend_name() -> str:
    return "paddle" if PADDLE_AVAILABLE else "unavailable"


@lru_cache(maxsize=1)
def _engine() -> Any:
    if not PADDLE_AVAILABLE:
        raise RuntimeError("PaddleOCR is not installed; install requirements-ocr.txt")
    # The Chinese model also recognizes Latin letters and Arabic numerals.
    return PaddleOCR(lang="ch", use_doc_orientation_classify=False, use_doc_unwarping=False)


def recognize(image: np.ndarray, mode: str = "auto") -> tuple[list[RecognitionCandidate], list[str]]:
    if mode in {"mock", "heuristic"}:
        return [], [f"OCR mode '{mode}' returns no text; no recognition was fabricated"]
    if not PADDLE_AVAILABLE:
        if mode == "paddle":
            raise RuntimeError("PaddleOCR requested but not installed; install requirements-ocr.txt")
        return [], ["PaddleOCR unavailable; text candidates omitted (heuristic fallback does not invent text)"]

    engine = _engine()
    try:
        if hasattr(engine, "predict"):
            raw = engine.predict(image)
            candidates = _parse_v3(raw)
        else:  # PaddleOCR 2.x compatibility
            raw = engine.ocr(image, cls=False)
            candidates = _parse_v2(raw)
    except Exception as exc:
        return [], [f"PaddleOCR failed and text candidates were omitted: {type(exc).__name__}: {exc}"]
    return candidates, []


def _parse_v2(raw: Any) -> list[RecognitionCandidate]:
    candidates: list[RecognitionCandidate] = []
    for page in raw or []:
        for item in page or []:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            polygon, text_score = item[0], item[1]
            if not isinstance(text_score, (list, tuple)) or len(text_score) < 2:
                continue
            candidates.append(_candidate(polygon, str(text_score[0]), float(text_score[1]), "paddleOCRv2"))
    return candidates


def _parse_v3(raw: Any) -> list[RecognitionCandidate]:
    candidates: list[RecognitionCandidate] = []
    for result in raw or []:
        payload = getattr(result, "json", result)
        if callable(payload):
            payload = payload()
        if isinstance(payload, dict) and "res" in payload:
            payload = payload["res"]
        if not isinstance(payload, dict):
            continue
        texts = payload.get("rec_texts", [])
        scores = payload.get("rec_scores", [])
        polygons = payload.get("rec_polys", payload.get("dt_polys", []))
        for polygon, text, score in zip(polygons, texts, scores):
            candidates.append(_candidate(polygon, str(text), float(score), "paddleOCRv3"))
    return candidates


def _candidate(polygon: Any, text: str, confidence: float, method: str) -> RecognitionCandidate:
    points = np.asarray(polygon, dtype=float).reshape(-1, 2)
    minimum = points.min(axis=0)
    maximum = points.max(axis=0)
    return RecognitionCandidate(
        candidate_type="text",
        value=text,
        bbox=BBox(
            x=max(0.0, float(minimum[0])),
            y=max(0.0, float(minimum[1])),
            width=max(0.0, float(maximum[0] - minimum[0])),
            height=max(0.0, float(maximum[1] - minimum[1])),
        ),
        confidence=max(0.0, min(1.0, confidence)),
        extraction_method=method,
        review_status=ReviewStatus.NEEDS_REVIEW,
        metadata={"polygon": points.tolist(), "languageModel": "ch (Chinese/English/digits)"},
    )
