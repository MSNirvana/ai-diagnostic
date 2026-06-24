"""诊断调度脑子（scout）：让 LLM 从问题地图决定本次要诊断哪些角度——不限于注册表。

设计意图（见架构讨论「起跑库不设边界」）：
- 固定诊断域是「加速器/起跑库」，不是「边界」。
- 命中已有域 → 回填该域 key，走注册表（借用其 KPI / 取数项 / 负责人 / 行业基准）。
- 注册表覆盖不到的关键角度 → 给一个 label，系统现场建一个 ad-hoc 域，脑子照样诊断，不漏。

best-effort：LLM 异常 / 解析失败 / 无核心问题时返回 []，dispatcher 回退到关键词路由，绝不阻断诊断。
本脑子的 prompt 同样可在后台版本化（module key = diagnosis_scout）。
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import LLMClient
from app.skills.configured import ConfiguredExpertSkill, ExpertConfig
from app.skills.parsing import parse_json_object
from app.skills.prompts import DIAGNOSIS_SCOUT
from app.skills.store import get_active_skill_version

SCOUT_MODULE_KEY = "diagnosis_scout"
ADHOC_PREFIX = "adhoc_"


@dataclass(frozen=True)
class ScoutAngle:
    module: str   # 已有域 key，或 ad-hoc slug（adhoc_前缀）
    label: str
    reason: str
    known: bool


def adhoc_module_key(label: str) -> str:
    """把新角度 label 转成稳定的 ad-hoc module key。"""
    slug = "".join(ch for ch in label.strip() if not ch.isspace() and ch not in "/\\\"'：:")
    return f"{ADHOC_PREFIX}{slug}" if slug else ""


def adhoc_skill(label: str) -> ConfiguredExpertSkill:
    """为注册表外的新角度现场建一个零 prose 域：判断由脑子按 label + 问题/数据生成。"""
    return ConfiguredExpertSkill(
        ExpertConfig(
            module=adhoc_module_key(label),
            method="adhoc-evidence",
            label=label,
            fallback_prompt="",
        )
    )


async def scout_angles(
    problem_map: dict,
    known: list[tuple[str, str]],
    llm: LLMClient,
    session: AsyncSession | None = None,
) -> list[ScoutAngle]:
    """调度脑子：返回本次该诊断的角度（含注册表外的新角度）。失败返回 []。"""
    if not problem_map or not str(problem_map.get("core_problem") or "").strip():
        return []

    system = DIAGNOSIS_SCOUT
    ver = await get_active_skill_version(session, SCOUT_MODULE_KEY)
    if ver and ver.system_prompt.strip():
        system = ver.system_prompt

    known_keys = {key for key, _ in known}
    payload = json.dumps(
        {
            "problem_map": problem_map,
            "known_domains": [{"key": key, "label": label} for key, label in known],
        },
        ensure_ascii=False,
    )
    try:
        raw = await llm.complete(system=system, prompt=payload)
        data = parse_json_object(raw)
    except Exception:  # noqa: BLE001 — 调度失败不阻断诊断
        return []

    angles: list[ScoutAngle] = []
    seen: set[str] = set()
    for item in (data.get("angles") or [])[:8]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        key = str(item.get("key") or "").strip()
        reason = str(item.get("reason") or "").strip()[:160]
        is_known = bool(item.get("known")) and key in known_keys
        if is_known:
            module = key
        else:
            module = adhoc_module_key(label)
        if not module or module in seen:
            continue
        seen.add(module)
        angles.append(ScoutAngle(module=module, label=label or key, reason=reason, known=is_known))
    return angles
