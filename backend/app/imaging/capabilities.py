"""Configured image-model capabilities exposed to the image workbench.

The provider contract is not fully confirmed yet. Deployments can set
GGOO_IMAGE_CAPABILITIES_JSON to exact model profiles verified by the gateway.
The conservative fallback does not claim unsupported sizes or quality modes.
"""
from __future__ import annotations

import json
import os
from typing import Any


def _fallback_capabilities() -> list[dict[str, Any]]:
    model = os.environ.get("GGOO_IMAGE_MODEL", "gpt-image-2").strip() or "gpt-image-2"
    return [
        {
            "model": model,
            "label": "gpt-image-2",
            "sizes": [
                {"value": "1024x1024", "label": "1K 方图", "aspect_ratio": "1:1"},
                {"value": "1536x1024", "label": "1K 横图", "aspect_ratio": "3:2"},
                {"value": "1024x1536", "label": "1K 竖图", "aspect_ratio": "2:3"},
                {"value": "2048x2048", "label": "2K 方图", "aspect_ratio": "1:1"},
                {"value": "2048x1152", "label": "2K 横图", "aspect_ratio": "16:9"},
                {"value": "3840x2160", "label": "4K 横图", "aspect_ratio": "16:9"},
                {"value": "2160x3840", "label": "4K 竖图", "aspect_ratio": "9:16"},
                {"value": "auto", "label": "自动", "aspect_ratio": "auto"},
            ],
            "aspect_ratios": [
                {"value": "1:1", "label": "1:1 方形"},
                {"value": "3:2", "label": "3:2 横向"},
                {"value": "2:3", "label": "2:3 纵向"},
                {"value": "16:9", "label": "16:9 横屏"},
                {"value": "9:16", "label": "9:16 竖屏"},
                {"value": "auto", "label": "自动"},
            ],
            "qualities": [
                {"value": "low", "label": "低"},
                {"value": "medium", "label": "中"},
                {"value": "high", "label": "高"},
                {"value": "auto", "label": "自动"},
            ],
            "backgrounds": [{"value": "opaque", "label": "不透明"}],
            "generation_counts": [1],
            "max_count": 1,
        }
    ]


def list_image_model_capabilities() -> list[dict[str, Any]]:
    raw = os.environ.get("GGOO_IMAGE_CAPABILITIES_JSON", "").strip()
    if not raw:
        return _fallback_capabilities()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return _fallback_capabilities()
    if not isinstance(value, list) or not value:
        return _fallback_capabilities()
    return [item for item in value if isinstance(item, dict)] or _fallback_capabilities()
