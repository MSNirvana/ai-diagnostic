"""项目已知信息收集 —— 二次诊断时复用历史，避免让老板重填。

从一个项目的历次诊断记录里，把用户填过的 facts 合并成"已知信息字典"。
问卷生成后据此预填字段，老板只需确认/修正，不必从零再填。

设计：取最近一次填过的非空值（新覆盖旧）；失败返回空字典，绝不影响问卷生成。
"""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord, Project


async def collect_known_facts(
    session: AsyncSession | None,
    project_id: str | None,
) -> dict[str, str]:
    """汇总该项目历次诊断里填过的 facts。

    返回 {fact_label: value}，label 即历史 facts 的 key（实测为中文字段名，
    如「主要竞品」），可直接与新问卷字段的 label 匹配。取最近一次非空值。
    """
    if session is None or not project_id:
        return {}
    try:
        # 按时间正序取，后填的覆盖先填的 → 字典里留下的是最近值
        stmt = (
            select(DiagnosisRecord)
            .where(DiagnosisRecord.project_id == project_id)
            .order_by(DiagnosisRecord.created_at.asc())
        )
        records = list(await session.scalars(stmt))
        known: dict[str, str] = {}
        for record in records:
            try:
                payload = json.loads(record.answers_json)
            except (ValueError, TypeError):
                continue
            for answer in payload.get("answers", []):
                facts = answer.get("facts") or {}
                for label, value in facts.items():
                    v = str(value).strip()
                    if v:  # 只记非空，避免空值覆盖掉历史真实值
                        known[str(label).strip()] = v
        # 项目画像里的稳定信息也并入（行业/主营等），作为兜底
        project = await session.get(Project, project_id)
        if project and project.profile_json:
            try:
                profile = json.loads(project.profile_json)
                for label, value in profile.items():
                    v = str(value).strip() if value is not None else ""
                    if v and str(label).strip() not in known:
                        known[str(label).strip()] = v
            except (ValueError, TypeError):
                pass
        return known
    except Exception:  # noqa: BLE001 — 取历史失败绝不拖垮问卷生成
        return {}


def match_known_value(field_label: str, field_key: str, known: dict[str, str]) -> str | None:
    """给一个问卷字段找历史已知值。精确匹配优先，再做包含匹配。"""
    if not known:
        return None
    label = (field_label or "").strip()
    key = (field_key or "").strip()
    # 1) label 精确命中
    if label and label in known:
        return known[label]
    # 2) key 精确命中（兼容用语义化 key 存的情况）
    if key and key in known:
        return known[key]
    # 3) 包含匹配：已知 key 是字段 label 的子串或反之（如「客单价」vs「平均客单价」）
    for known_label, value in known.items():
        if label and (known_label in label or label in known_label) and len(known_label) >= 2:
            return value
    return None
