"""Configured image-model capabilities exposed to the image workbench.

The fallback is deliberately limited to the image sizes verified by the
current gateway contract. Deployments can opt into additional sizes only by
setting ``GGOO_IMAGE_CAPABILITIES_JSON`` after testing them against GGOO.
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
                {"value": "auto", "label": "自动", "aspect_ratio": "auto"},
            ],
            "aspect_ratios": [
                {"value": "1:1", "label": "1:1 方形"},
                {"value": "3:2", "label": "3:2 横向"},
                {"value": "2:3", "label": "2:3 纵向"},
                {"value": "auto", "label": "自动"},
            ],
            "qualities": [
                {"value": "low", "label": "低"},
                {"value": "medium", "label": "中"},
                {"value": "high", "label": "高"},
                {"value": "auto", "label": "自动"},
            ],
            "backgrounds": [{"value": "opaque", "label": "不透明"}],
            # The gateway is called once per candidate by the job runner, so
            # this does not depend on provider support for `n > 1`.
            "generation_counts": [1, 2, 4],
            "max_count": 4,
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
