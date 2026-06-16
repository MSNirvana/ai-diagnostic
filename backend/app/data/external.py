"""外部行业基准抓取 —— 诊断流水线阶段2的外部数据层。

策略（选项C 起步，不被搜索 API 阻塞）：
  ① 先查知识库（benchmark_store）：命中未过期 → 直接用
  ② 未命中 → 用 LLM 凭训练知识估算行业基准，标注 needs_verification=True（待联网核实）
  ③ 写回知识库供下次复用

后续升级（P1）：把 ② 换成 LLM+web search 真实联网，needs_verification=False。
接口对调用方（configured.py）保持稳定：仍返回 dict。
"""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.data.benchmark_store import get_cached_benchmark, save_benchmark
from app.llm.base import LLMClient
from app.skills.parsing import parse_json_object

_BENCHMARK_SYSTEM = """你是行业基准数据分析师。基于你的训练知识，为给定的行业场景和诊断维度，
给出该行业的关键经营指标基准区间（如获客成本、毛利率、转化率、回本周期等的典型范围）。

严格输出 JSON：{"metrics": [{"name": "指标名", "typical_range": "典型区间", "note": "简短说明"}], "summary": "一句话行业现状"}
- 只给你有把握的常识性基准，不确定的指标不要编
- 数值用区间表达（如"获客成本 80-150 元"），不要给精确的假数字
- 最多 6 个指标"""


async def fetch_industry_benchmark(
    module: str,
    keywords: list[str],
    *,
    scenario_key: str = "",
    scenario_label: str = "",
    evidence_lens: list[str] | None = None,
    llm: LLMClient | None = None,
    session: AsyncSession | None = None,
) -> dict:
    """获取外部行业基准。三层：查库 → LLM估算 → 沉淀。

    llm/session 为 None 时降级返回轻量占位（保证离线测试和旧调用不崩）。
    """
    base = {
        "module": module,
        "keywords": keywords,
        "scenario_key": scenario_key,
        "scenario_label": scenario_label,
        "evidence_lens": evidence_lens or [],
    }

    # ① 查知识库
    cached = await get_cached_benchmark(
        session, scenario_key=scenario_key, module=module, data_type="benchmark"
    )
    if cached is not None:
        return {**base, "benchmark": cached}

    # llm 不可用 → 降级占位（不写库）
    if llm is None:
        return {**base, "benchmark": {"note": "external benchmark unavailable (no llm)"}}

    # ② LLM 估算
    try:
        prompt = json.dumps(
            {
                "scenario": scenario_label or scenario_key,
                "module": module,
                "diagnosis_lens": evidence_lens or [],
                "keywords": keywords,
            },
            ensure_ascii=False,
        )
        raw = await llm.complete(system=_BENCHMARK_SYSTEM, prompt=prompt)
        payload = parse_json_object(raw)
        payload["_estimated"] = True  # 标记：LLM 估算，待联网核实
    except Exception:  # noqa: BLE001 — 抓取失败降级，不影响诊断
        return {**base, "benchmark": {"note": "external benchmark fetch failed"}}

    # ③ 沉淀回库
    await save_benchmark(
        session,
        scenario_key=scenario_key,
        module=module,
        data_type="benchmark",
        keywords=keywords,
        payload=payload,
        source="llm_estimate",
        needs_verification=True,
    )

    return {**base, "benchmark": payload}
