"""相似案例检索（Loop 3 案例飞轮的"取用"端）。

诊断时，按当前模块 + 行业 + 场景，从 CaseAsset 里召回最相似的历史案例，
作为 few-shot 上下文注入 skill prompt。让"积累的案例真正参与诊断"——
客户越多，同行业同场景的先例越多，诊断越贴合实际，竞品越难复制。

设计取舍：
- 不用向量库。现阶段案例量（几十到几百）用关键词/标签匹配足够，
  且可解释、零额外依赖。案例量上万再考虑向量检索。
- 严格旁路：检索失败一律返回空列表，绝不影响主诊断。
- 只取脱敏字段（diagnosis_summary / problem_map / data_gaps），无 PII。
- 排除当前诊断自己（按 source_record_id），避免"拿自己当先例"。
"""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CaseAsset

# 召回数量上限：注入太多会稀释 prompt 信号、拉高 token，3 条足够给模型先例感。
MAX_CASES = 3
# 候选池上限：先按标签粗筛拿一批，再在内存里精排，避免全表扫描。
CANDIDATE_POOL = 50


def _score(case: CaseAsset, module: str, industry: str, scenario_key: str) -> int:
    """相似度打分（越大越像）。标签命中为主，简单可解释。

    - 同主战场 module：最强信号（+4）
    - 同场景 scenario_key：+3
    - 同行业 industry：+2
    - module 出现在案例用过的 skills 里：+1
    """
    score = 0
    if module and case.primary_module == module:
        score += 4
    if scenario_key and case.scenario_key == scenario_key:
        score += 3
    if industry and case.industry == industry:
        score += 2
    if module:
        try:
            skills_used = json.loads(case.skills_used_json or "[]")
            if module in skills_used:
                score += 1
        except (ValueError, TypeError):
            pass
    return score


def _to_brief(case: CaseAsset, module: str) -> dict:
    """把 CaseAsset 压成注入 prompt 的精简先例（只含脱敏信息）。

    优先给出当前模块在该案例里的结论/信号，其次给整体场景与缺数据，
    让模型获得"同类企业在这个模块通常什么信号、什么结论、缺什么数据"的先验。
    """
    try:
        summary = json.loads(case.diagnosis_summary_json or "{}")
    except (ValueError, TypeError):
        summary = {}
    try:
        problem_map = json.loads(case.problem_map_json or "{}")
    except (ValueError, TypeError):
        problem_map = {}
    try:
        data_gaps = json.loads(case.data_gaps_json or "[]")
    except (ValueError, TypeError):
        data_gaps = []

    module_finding = summary.get(module) if isinstance(summary, dict) else None

    return {
        "industry": case.industry,
        "scenario_key": case.scenario_key,
        "primary_module": case.primary_module,
        "module_finding": module_finding,   # 当前模块在该先例里的 {signal, conclusion, confidence}
        "all_findings": summary,             # 全模块脱敏摘要
        "problem_map": problem_map,
        "data_gaps": data_gaps,
    }


async def retrieve_similar_cases(
    session: AsyncSession | None,
    module: str,
    industry: str = "",
    scenario_key: str = "",
    exclude_record_id: str | None = None,
    limit: int = MAX_CASES,
) -> list[dict]:
    """召回与当前诊断最相似的历史案例（脱敏先例）。

    失败一律返回 []，绝不抛出影响主诊断。
    """
    if session is None or not module:
        return []
    try:
        # 粗筛：行业或场景或主战场任一命中即进候选池（OR 条件，靠打分精排）。
        conditions = []
        if industry:
            conditions.append(CaseAsset.industry == industry)
        if scenario_key:
            conditions.append(CaseAsset.scenario_key == scenario_key)
        if module:
            conditions.append(CaseAsset.primary_module == module)

        stmt = select(CaseAsset)
        if conditions:
            from sqlalchemy import or_
            stmt = stmt.where(or_(*conditions))
        stmt = stmt.order_by(CaseAsset.created_at.desc()).limit(CANDIDATE_POOL)

        candidates = list(await session.scalars(stmt))
        if not candidates:
            return []

        scored = []
        for case in candidates:
            if exclude_record_id and case.source_record_id == exclude_record_id:
                continue
            s = _score(case, module, industry, scenario_key)
            if s <= 0:
                continue
            scored.append((s, case))

        # 按分数降序，分数相同的新案例优先（created_at 隐含在候选顺序里）
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [_to_brief(case, module) for _, case in scored[:limit]]
    except Exception:  # noqa: BLE001 — 检索是旁路，任何失败都不能影响诊断
        return []
