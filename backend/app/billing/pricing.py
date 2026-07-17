"""Point estimation for billable tasks.

The real price list (per tool/mode/model) is still pending business input
(handover doc section 16: "首版文生图模型、价格..."). Until then this reads
an optional `BUILD_PRICING_JSON` env var so ops can configure prices without
a code change; when nothing is configured we return `None` rather than a
made-up number, and callers must show "暂无法预估" instead of a fake quote.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any


@lru_cache(maxsize=1)
def _price_table() -> dict[str, Any]:
    raw = os.environ.get("BUILD_PRICING_JSON", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def estimate_points(tool: str, mode: str = "", model: str = "") -> int | None:
    """Look up an estimated point cost for `tool`/`mode`/`model`.

    Table shape: `{tool: {mode: {model: points, "default": points}, "default": points}}`.
    Any missing level falls back to that level's `"default"` key. Returns
    `None` when no price is configured at all so the caller never invents a
    number.
    """
    table = _price_table()
    tool_table = table.get(tool)
    if tool_table is None:
        tool_table = table.get("default")
    if not isinstance(tool_table, dict):
        return _coerce_points(tool_table)

    mode_table = tool_table.get(mode) if mode else None
    if mode_table is None:
        mode_table = tool_table.get("default")
    if not isinstance(mode_table, dict):
        return _coerce_points(mode_table)

    if model and model in mode_table:
        return _coerce_points(mode_table.get(model))
    return _coerce_points(mode_table.get("default"))


def _coerce_points(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _reset_price_table_cache_for_tests() -> None:
    _price_table.cache_clear()
