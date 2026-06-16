"""行业基准知识库测试：缓存命中/过期/降级。"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.data.benchmark_store import get_cached_benchmark, _expiry_for, EXPIRY_DAYS
from app.data.external import fetch_industry_benchmark
from app.db.models import IndustryBenchmark


def test_expiry_tiers():
    """不同数据类型过期窗口不同。"""
    now = datetime.now(timezone.utc)
    # 过期时间 = now + N天，用秒数判断更精确（.days 会向下取整少 1）
    assert round((_expiry_for("benchmark") - now).total_seconds() / 86400) == 30
    assert round((_expiry_for("competitor") - now).total_seconds() / 86400) == 7
    assert round((_expiry_for("policy") - now).total_seconds() / 86400) == 1
    assert EXPIRY_DAYS["benchmark"] == 30


async def test_get_cached_none_when_no_session():
    assert await get_cached_benchmark(None, scenario_key="x", module="m") is None


async def test_fetch_degrades_without_llm():
    """llm 为 None 时返回占位，不崩。"""
    result = await fetch_industry_benchmark(
        "market", ["竞品强"], scenario_key="live_commerce", llm=None, session=None
    )
    assert result["module"] == "market"
    assert "benchmark" in result
    assert "unavailable" in result["benchmark"]["note"]


class _FakeBenchLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "metrics": [{"name": "获客成本", "typical_range": "80-150元", "note": "直播电商"}],
            "summary": "直播电商获客成本上升",
        }, ensure_ascii=False)


async def test_fetch_uses_llm_estimate_when_no_cache():
    """无 session（不沉淀）时，llm 估算照样返回结构化基准。"""
    result = await fetch_industry_benchmark(
        "market", ["获客贵"],
        scenario_key="live_commerce",
        llm=_FakeBenchLLM(),
        session=None,
    )
    bench = result["benchmark"]
    assert bench.get("_estimated") is True
    assert bench["metrics"][0]["name"] == "获客成本"
