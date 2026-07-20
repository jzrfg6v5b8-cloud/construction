from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from .models import BBox, RecognitionCandidate, ReviewStatus

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover - base requirements install it
    pass


@dataclass
class ProcessedImage:
    color: np.ndarray
    binary: np.ndarray
    candidates: list[RecognitionCandidate]
    warnings: list[str]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_image(data: bytes) -> np.ndarray:
    """Decode, apply EXIF orientation, flatten transparency, and return BGR."""
    with Image.open(io.BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ("RGBA", "LA") or "transparency" in image.info:
            rgba = image.convert("RGBA")
            white = Image.new("RGBA", rgba.size, "white")
            image = Image.alpha_composite(white, rgba).convert("RGB")
        else:
            image = image.convert("RGB")
        return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def crop_white_border(image: np.ndarray, threshold: int = 248) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mask = gray < threshold
    points = cv2.findNonZero(mask.astype(np.uint8))
    if points is None:
        return image.copy()
    x, y, width, height = cv2.boundingRect(points)
    return image[y : y + height, x : x + width].copy()


def perspective_correct(image: np.ndarray) -> tuple[np.ndarray, bool]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.shape[0] * image.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(polygon) != 4 or cv2.contourArea(polygon) < image_area * 0.25:
            continue
        points = polygon.reshape(4, 2).astype(np.float32)
        ordered = _order_points(points)
        tl, tr, br, bl = ordered
        width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        if width < 2 or height < 2:
            break
        target = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype=np.float32,
        )
        matrix = cv2.getPerspectiveTransform(ordered, target)
        return cv2.warpPerspective(image, matrix, (width, height), borderValue=(255, 255, 255)), True
    return image.copy(), False


def preprocess_image(image: np.ndarray) -> ProcessedImage:
    warnings: list[str] = []
    cropped = crop_white_border(image)
    corrected, changed = perspective_correct(cropped)
    if changed:
        warnings.append("perspective correction applied heuristically; review geometry")
    gray = cv2.cvtColor(corrected, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    binary = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )
    return ProcessedImage(
        color=corrected,
        binary=binary,
        candidates=detect_structural_candidates(binary),
        warnings=warnings,
    )


def detect_structural_candidates(binary: np.ndarray) -> list[RecognitionCandidate]:
    inverted = 255 - binary
    lines = cv2.HoughLinesP(
        inverted,
        rho=1,
        theta=np.pi / 180,
        threshold=60,
        minLineLength=max(25, min(binary.shape[:2]) // 12),
        maxLineGap=12,
    )
    if lines is None:
        return []

    distance = cv2.distanceTransform((inverted > 0).astype(np.uint8), cv2.DIST_L2, 3)
    candidates: list[RecognitionCandidate] = []
    for raw in lines[:300]:
        x1, y1, x2, y2 = (int(value) for value in raw[0])
        length = float(np.hypot(x2 - x1, y2 - y1))
        thickness = _sample_thickness(distance, x1, y1, x2, y2)
        candidate_type = "wall" if thickness >= 2.2 else "dimensionLine" if length < max(binary.shape) * 0.45 else "line"
        confidence = min(0.85, 0.35 + length / max(binary.shape) * 0.35 + min(thickness, 8) * 0.02)
        candidates.append(
            RecognitionCandidate(
                candidate_type=candidate_type,
                bbox=BBox(
                    x=float(min(x1, x2)),
                    y=float(min(y1, y2)),
                    width=float(max(1, abs(x2 - x1))),
                    height=float(max(1, abs(y2 - y1))),
                ),
                confidence=round(confidence, 4),
                extraction_method="opencvHoughHeuristic",
                review_status=ReviewStatus.NEEDS_REVIEW,
                metadata={
                    "endpoints": [[x1, y1], [x2, y2]],
                    "lengthPixels": round(length, 2),
                    "estimatedHalfThicknessPixels": round(thickness, 2),
                },
            )
        )
    return candidates


def write_derived_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    success, encoded = cv2.imencode(path.suffix or ".png", image)
    if not success:
        raise ValueError(f"cannot encode derived image: {path.name}")
    path.write_bytes(encoded.tobytes())


def _order_points(points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(differences)]
    ordered[3] = points[np.argmax(differences)]
    return ordered


def _sample_thickness(distance: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> float:
    xs = np.linspace(x1, x2, 20).astype(int).clip(0, distance.shape[1] - 1)
    ys = np.linspace(y1, y2, 20).astype(int).clip(0, distance.shape[0] - 1)
    values = distance[ys, xs]
    return float(np.median(values))
