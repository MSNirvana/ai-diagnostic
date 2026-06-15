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

from app.eval.assertions import TEMPLATE_PHRASES, _NUMBER_TOKEN_RE
from app.llm.base import LLMClient
from app.models.result import ModuleResult
from app.models.warroom import WarRoomPlan

# LLM 增强的硬超时：宁可降级给模板，也不让老板干等。
_ENHANCE_TIMEOUT_S = 25.0


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


def _build_prompt(plan: WarRoomPlan, results: list[ModuleResult]) -> tuple[str, str]:
    system = (
        "你是给中小企业老板写经营作战方案的资深顾问。"
        "下面给你一份已经算好结构的方案草稿（战场、优先级、指标都已定，不要改），"
        "你的唯一任务：把其中几段【叙事文字】改写得像一个懂行的人在跟老板讲话——"
        "具体、有判断、点到痛处，而不是正确的废话。\n"
        "硬规则：\n"
        "1. 不要引入任何草稿里没有出现过的数字。\n"
        "2. 禁止套话：'未来30天优先打''建议关注''需要引起重视''助力企业''持续改进'等一律不准用。\n"
        "3. 每段控制在 1-2 句，结论先行。\n"
        "4. 只输出 JSON：{\"summary\":\"...\",\"objective\":\"...\",\"decision_details\":[\"...\"],\"action_details\":[\"...\"]}，"
        "decision_details 和 action_details 的条数必须和草稿给的条数一致，按顺序对应。"
    )
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
    prompt = "方案草稿：\n" + json.dumps(draft, ensure_ascii=False, indent=2)
    return system, prompt


async def enhance_war_room_plan(
    plan: WarRoomPlan,
    results: list[ModuleResult],
    llm: LLMClient | None,
) -> WarRoomPlan:
    """用 LLM 重写叙事字段；任何失败都优雅降级返回原 plan。"""
    if llm is None or not plan.department_actions and not plan.summary:
        return plan
    try:
        system, prompt = _build_prompt(plan, results)
        raw = await asyncio.wait_for(
            llm.complete(system=system, prompt=prompt), timeout=_ENHANCE_TIMEOUT_S
        )
        payload = _parse_json(raw)
    except Exception:  # noqa: BLE001 — 网关抽风/超时/解析失败一律降级
        return plan
    if not isinstance(payload, dict):
        return plan

    allowed = _allowed_numbers(results)

    # summary
    cand = payload.get("summary", "")
    if isinstance(cand, str) and _critic_accepts(cand, plan.summary, allowed):
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
