from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda name: _to_camel(name), populate_by_name=True)


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ReviewStatus(str, Enum):
    UNREVIEWED = "UNREVIEWED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class BBox(CamelModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class RecognitionCandidate(CamelModel):
    candidate_type: Literal["text", "line", "wall", "dimensionLine"]
    value: str | None = None
    bbox: BBox
    confidence: float = Field(ge=0, le=1)
    extraction_method: str
    review_status: ReviewStatus = ReviewStatus.NEEDS_REVIEW
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobSource(CamelModel):
    filename: str
    media_type: str | None = None
    data_base64: str | None = None
    path: str | None = None

    @model_validator(mode="after")
    def exactly_one_source(self) -> "JobSource":
        if bool(self.data_base64) == bool(self.path):
            raise ValueError("exactly one of dataBase64 or path is required")
        return self


class JobOptions(CamelModel):
    output_dir: str | None = None
    raster_dpi: int = Field(default=200, ge=72, le=600)
    ocr_mode: Literal["auto", "paddle", "heuristic", "mock"] = "auto"
    save_derived_files: bool = True


class JobRequest(CamelModel):
    job_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    source: JobSource
    options: JobOptions = Field(default_factory=JobOptions)


class PageResult(CamelModel):
    page_index: int = Field(ge=0)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    sha256: str
    derived_files: list[str] = Field(default_factory=list)
    candidates: list[RecognitionCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class JobResult(CamelModel):
    schema_version: Literal["1.0"] = "1.0"
    job_id: str
    status: Literal["succeeded", "partial", "failed"]
    source_sha256: str
    pages: list[PageResult] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class ClassifyRequest(CamelModel):
    filename: str | None = None
    media_type: str | None = None
    text: str | None = None
    tags: list[str] = Field(default_factory=list)


class Classification(CamelModel):
    category: Literal["product", "material", "site", "procurement", "unknown"]
    confidence: float = Field(ge=0, le=1)
    extraction_method: Literal["keywordHeuristic"]
    review_status: ReviewStatus = ReviewStatus.NEEDS_REVIEW
    matched_keywords: list[str] = Field(default_factory=list)


class HealthResponse(CamelModel):
    status: Literal["ok"]
    service: Literal["vision-worker"] = "vision-worker"
    ocr_backend: Literal["paddle", "unavailable"]
