from __future__ import annotations

from .models import Classification, ClassifyRequest, ReviewStatus


KEYWORDS: dict[str, tuple[str, ...]] = {
    "product": ("商品", "产品", "型号", "sku", "空调", "设备", "机型"),
    "material": ("材料", "建材", "板材", "水泥", "钢材", "管材", "辅材"),
    "site": ("现场", "工地", "施工", "安装", "完工", "巡检", "测量"),
    "procurement": ("采购", "询价", "报价", "订单", "供应商", "发票", "送货单", "合同"),
}


def classify(request: ClassifyRequest) -> Classification:
    corpus = " ".join(
        part
        for part in [request.filename or "", request.media_type or "", request.text or "", *request.tags]
        if part
    ).lower()
    scores = {
        category: [keyword for keyword in keywords if keyword.lower() in corpus]
        for category, keywords in KEYWORDS.items()
    }
    category, matches = max(scores.items(), key=lambda item: len(item[1]))
    if not matches:
        return Classification(
            category="unknown",
            confidence=0.0,
            extraction_method="keywordHeuristic",
            review_status=ReviewStatus.NEEDS_REVIEW,
        )
    confidence = min(0.8, 0.35 + 0.12 * len(matches))
    return Classification(
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        extraction_method="keywordHeuristic",
        review_status=ReviewStatus.NEEDS_REVIEW,
        matched_keywords=matches,
    )
