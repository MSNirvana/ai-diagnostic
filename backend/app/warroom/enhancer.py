"""作战方案叙事增强（Loop 4）。

三层架构里的第二、三层：
- 第一层（composer.py）：确定性骨架，永远先算出可用方案。
- 第二层（本文件 enhance_*）：用 LLM 把模板腔的叙事字段重写成有血肉的话。
- 第三层（本文件 _critic_*）：套话/编造数字则该字段回退到确定性原值。

关键设计：LLM 只重写"叙事"，绝不碰"结构"（优先级/指标/依赖图/置信度）。
LLM 不可用、超时、或产出不过 critic —— 一律优雅降级回原值，方案照常交付。
这样网关抽风（你见过的 404/503/被拦）也不会让老板看不到方案。
"""
import asyncio
import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.eval.assertions import TEMPLATE_PHRASES, _NUMBER_TOKEN_RE
from app.llm.base import LLMClient
from app.models.result import ModuleResult
from app.models.warroom import WarRoomPlan
from app.skills.prompts import WAR_ROOM_ENHANCER
from app.skills.store import get_active_skill_version

# LLM 增强的硬超时：宁可降级给模板，也不让老板干等。
_ENHANCE_TIMEOUT_S = 25.0
# 「作战室收敛」脑子的 module key —— 可在后台版本化治理。
WAR_ROOM_ENHANCER_KEY = "war_room_enhancer"


def _norm_num(token: str) -> str:
    return token.strip(",.").replace(",", "").rstrip("%")


def _allowed_numbers(results: list[ModuleResult]) -> set[str]:
    """方案里允许出现的数字 = 所有 evidence/conclusion/benchmark 里出现过的数字。

    LLM 重写时引入任何新的"像统计量"的数字（≥2位或带%）即视为编造，拒绝。
    """
    haystack: list[str] = []
    for r in results:
        haystack.append(r.conclusion)
        haystack.extend(e.text for e in r.evidence)
        for a in r.actions:
            haystack.append(a)
        if r.evidence_package:
            for b in r.evidence_package.benchmarks:
                haystack.append(f"{b.name}{b.value}")
    nums: set[str] = set()
    for text in haystack:
        for m in _NUMBER_TOKEN_RE.findall(text):
            nums.add(_norm_num(m))
    return {n for n in nums if n}


def _fabricated_numbers(text: str, allowed: set[str]) -> list[str]:
    bad: list[str] = []
    for m in _NUMBER_TOKEN_RE.findall(text):
        norm = _norm_num(m)
        if (len(norm) >= 2 or "%" in m) and norm not in allowed:
            bad.append(m)
    return bad


def _has_template_phrase(text: str) -> bool:
    return any(p in text for p in TEMPLATE_PHRASES)


def _critic_accepts(candidate: str, original: str, allowed: set[str]) -> bool:
    """critic 把关：候选叙事必须比原值好且不作弊，否则回退。"""
    cand = (candidate or "").strip()
    if not cand:
        return False
    if cand == original.strip():
        return False
    if len(cand) < 8:  # 太短不是有效改写
        return False
    if _has_template_phrase(cand):
        return False
    if _fabricated_numbers(cand, allowed):
        return False
    return True


async def _resolve_system(session: AsyncSession | None) -> str:
    """取「作战室收敛」skill 的激活版本（可后台版本化），无则用代码兜底常量。"""
    if session is not None:
        try:
            ver = await get_active_skill_version(session, WAR_ROOM_ENHANCER_KEY)
            if ver and ver.system_prompt.strip():
                return ver.system_prompt
        except Exception:  # noqa: BLE001 — 取版本失败不影响增强，退兜底
            pass
    return WAR_ROOM_ENHANCER


def _build_draft_prompt(plan: WarRoomPlan, results: list[ModuleResult]) -> str:
    draft = {
        "primary_battlefield": plan.primary_battlefield,
        "summary": plan.summary,
        "objective": plan.objective,
        "decision_titles": [d.title for d in plan.decision_items],
        "decision_details": [d.detail for d in plan.decision_items],
        "action_titles": [a.action_title for a in plan.department_actions],
        "action_details": [a.action_detail for a in plan.department_actions],
        "key_evidence": plan.evidence_summary[:5],
    }
    return "方案草稿：\n" + json.dumps(draft, ensure_ascii=False, indent=2)


async def enhance_war_room_plan(
    plan: WarRoomPlan,
    results: list[ModuleResult],
    llm: LLMClient | None,
    session: AsyncSession | None = None,
) -> WarRoomPlan:
    """用 LLM 重写叙事字段；任何失败都优雅降级返回原 plan。"""
    if llm is None or not plan.department_actions and not plan.summary:
        return plan
    try:
        system = await _resolve_system(session)
        prompt = _build_draft_prompt(plan, results)
        raw = await asyncio.wait_for(
            llm.complete(system=system, prompt=prompt), timeout=_ENHANCE_TIMEOUT_S
        )
        payload = _parse_json(raw)
    except Exception:  # noqa: BLE001 — 网关抽风/超时/解析失败一律降级
        return plan
    if not isinstance(payload, dict):
        return plan

    allowed = _allowed_numbers(results)

    # summary —— 额外硬约束：必须保持一句话，过长的改写一律弃用，退回 composer 的精简版
    cand = payload.get("summary", "")
    if isinstance(cand, str) and len(cand.strip()) <= 56 and _critic_accepts(cand, plan.summary, allowed):
        plan.summary = cand.strip()

    # objective
    cand = payload.get("objective", "")
    if isinstance(cand, str) and _critic_accepts(cand, plan.objective, allowed):
        plan.objective = cand.strip()

    # decision_items[].detail —— 按序对应，逐条 critic
    details = payload.get("decision_details")
    if isinstance(details, list) and len(details) == len(plan.decision_items):
        for item, cand in zip(plan.decision_items, details):
            if isinstance(cand, str) and _critic_accepts(cand, item.detail, allowed):
                item.detail = cand.strip()

    # department_actions[].action_detail —— 按序对应，逐条 critic
    a_details = payload.get("action_details")
    if isinstance(a_details, list) and len(a_details) == len(plan.department_actions):
        for action, cand in zip(plan.department_actions, a_details):
            if isinstance(cand, str) and _critic_accepts(cand, action.action_detail, allowed):
                action.action_detail = cand.strip()

    return plan


def _parse_json(raw: str) -> object:
    """容忍 ```json 包裹和前后噪音。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text[3:] else text[3:]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("`").strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)
