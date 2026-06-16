"""行业基准知识库读写 —— "抓取即沉淀"的核心（诊断流水线阶段2）。

诊断需要外部基准时调用 get_or_fetch_benchmark：
  ① 查库：同 scenario+module+data_type 且未过期 → 直接返回（快、省钱）
  ② 未命中 → fetcher 实时抓 → 结构化
  ③ 写回库（带分级过期）→ 返回

库越用越厚，命中率越来越高，抓取成本越来越低。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import IndustryBenchmark

# 过期分级（天）：不同数据类型时效性不同
EXPIRY_DAYS = {
    "benchmark": 30,    # 行业基准相对稳定
    "competitor": 7,    # 竞品动态变化快
    "policy": 1,        # 政策监管时效性最强
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expiry_for(data_type: str) -> datetime:
    return _now() + timedelta(days=EXPIRY_DAYS.get(data_type, 30))


async def get_cached_benchmark(
    session: AsyncSession | None,
    *,
    scenario_key: str,
    module: str,
    data_type: str = "benchmark",
) -> dict | None:
    """查库：命中且未过期返回 payload，否则 None。session 为 None 直接 None。"""
    if session is None:
        return None
    stmt = (
        select(IndustryBenchmark)
        .where(
            IndustryBenchmark.scenario_key == scenario_key,
            IndustryBenchmark.module == module,
            IndustryBenchmark.data_type == data_type,
        )
        .order_by(desc(IndustryBenchmark.fetched_at))
        .limit(1)
    )
    row = await session.scalar(stmt)
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < _now():
        return None  # 已过期，让上层重抓
    try:
        payload = json.loads(row.payload_json)
    except Exception:  # noqa: BLE001
        return None
    payload["_cache"] = {
        "source": row.source,
        "needs_verification": row.needs_verification,
        "fetched_at": str(row.fetched_at),
    }
    return payload


async def save_benchmark(
    session: AsyncSession | None,
    *,
    scenario_key: str,
    module: str,
    data_type: str,
    keywords: list[str],
    payload: dict,
    source: str,
    needs_verification: bool,
) -> None:
    """抓到的基准写回库。用独立 session 写，绝不碰诊断的共享事务。

    诊断是多 skill 并行（asyncio.gather），在共享 session 上中途 commit 会破坏
    外层事务状态。沉淀本就是旁路，用独立 session 隔离，失败也不抛。
    """
    try:
        from app.db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as own_session:
            row = IndustryBenchmark(
                scenario_key=scenario_key,
                module=module,
                data_type=data_type,
                keywords_json=json.dumps(keywords, ensure_ascii=False),
                payload_json=json.dumps(payload, ensure_ascii=False),
                source=source,
                needs_verification=needs_verification,
                expires_at=_expiry_for(data_type),
            )
            own_session.add(row)
            await own_session.commit()
    except Exception:  # noqa: BLE001 — 沉淀失败不影响诊断
        pass
