"""AI-powered project archive refinement.

Turns raw questionnaire/conversation facts into concise, de-duplicated archive
facts before they are shown in project files. This is a sidecar: failures must
never break diagnosis delivery.
"""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProjectMemoryEntry
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.skills.parsing import parse_json_object
from app.skills.prompts import ARCHIVE_REFINEMENT
from app.skills.skill_network import skill_label
from app.skills.store import get_active_skill_version


KNOWN_ARCHIVE_MODULES: dict[str, str] = {
    "market": "市场与客户",
    "product": "产品与服务",
    "sales": "销售与增长",
    "ops": "运营与供应链",
    "org": "组织与人才",
    "finance": "财务与资本",
    "data_systems": "数据系统",
    "retention_churn": "留存与流失",
    "channel_franchise": "渠道与加盟",
    "legal_compliance": "法务合规",
    "policy": "政策与监管",
    "supply_chain": "供应链",
    "service_delivery": "交付与售后",
}

LOW_VALUE_LABELS = {"补充说明", "目前情况", "其他补充", "请描述一下"}


async def refine_questionnaire_archive(
    session: AsyncSession,
    *,
    project_id: str | None,
    questionnaire: Questionnaire,
    results: list[ModuleResult] | None,
    llm: LLMClient | None,
    user_id: str | None = None,
    source_id: str | None = None,
) -> None:
    if not project_id or not questionnaire.answers:
        return
    raw_modules = _questionnaire_modules(questionnaire)
    if not raw_modules:
        return
    payload = {
        "project_profile": questionnaire.problem_map or {},
        "modules": raw_modules,
        "result_modules": [result.module for result in (results or [])],
        "available_modules": [
            {"module": key, "label": label} for key, label in KNOWN_ARCHIVE_MODULES.items()
        ],
    }
    refined = await _llm_refine(session, llm, payload)
    if not refined:
        refined = _fallback_refine(raw_modules)
    await _store_refined_archive(
        session,
        project_id=project_id,
        modules=refined,
        user_id=user_id,
        source_id=source_id or questionnaire.session_id,
    )


async def _llm_refine(
    session: AsyncSession,
    llm: LLMClient | None,
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    if llm is None:
        return []
    try:
        skill_version = await get_active_skill_version(session, "archive_refinement")
        system = skill_version.system_prompt if skill_version else ARCHIVE_REFINEMENT
        raw = await llm.complete(system=system, prompt=json.dumps(payload, ensure_ascii=False))
        data = parse_json_object(raw)
        return _normalize_refined_modules(data.get("modules") or [])
    except Exception:  # noqa: BLE001 - archive refinement is non-blocking.
        return []


def _questionnaire_modules(questionnaire: Questionnaire) -> list[dict[str, Any]]:
    modules: list[dict[str, Any]] = []
    for answer in questionnaire.answers:
        facts = []
        for key, value in (answer.facts or {}).items():
            label = str(key or "").strip()
            text = str(value or "").strip()
            if not label or not text:
                continue
            if label.startswith("file_") or "_file_" in label:
                continue
            facts.append({"label": label, "value": text})
        if not facts and not answer.pains:
            continue
        modules.append(
            {
                "module": answer.module,
                "label": skill_label(answer.module),
                "facts": facts,
                "pains": answer.pains,
                "free_text": str(answer.facts.get("补充说明", "") if answer.facts else "").strip(),
            }
        )
    return modules


def _normalize_refined_modules(raw_modules: Any) -> list[dict[str, Any]]:
    modules: list[dict[str, Any]] = []
    if not isinstance(raw_modules, list):
        return modules
    for raw_module in raw_modules:
        if not isinstance(raw_module, dict):
            continue
        module_key = _route_module(str(raw_module.get("module") or ""))
        facts = []
        for raw_fact in raw_module.get("facts") or []:
            if not isinstance(raw_fact, dict):
                continue
            label = _clean_label(raw_fact.get("label"))
            value = _clean_value(raw_fact.get("value"))
            if not label or not value:
                continue
            facts.append(
                {
                    "label": label,
                    "value": value,
                    "display": _normalize_display(raw_fact.get("display"), value),
                    "source_labels": [
                        str(item).strip()
                        for item in (raw_fact.get("source_labels") or [])
                        if str(item).strip()
                    ][:4],
                }
            )
        if facts:
            modules.append(
                {
                    "module": module_key,
                    "label": KNOWN_ARCHIVE_MODULES.get(module_key, skill_label(module_key)),
                    "summary": _clean_value(raw_module.get("summary"))[:160],
                    "facts": facts[:8],
                }
            )
    return modules


def _fallback_refine(raw_modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    for module in raw_modules:
        for fact in module.get("facts") or []:
            label = _clean_label(fact.get("label"))
            value = _clean_value(fact.get("value"))
            if not label or not value:
                continue
            module_key = _route_module(f"{module.get('module', '')} {label} {value}")
            label = _rewrite_label(label, value)
            buckets.setdefault(module_key, []).append(
                {
                    "label": label,
                    "value": _compact_value(value),
                    "display": _infer_display(label, value),
                    "source_labels": [str(fact.get("label") or "").strip()][:1],
                }
            )
    refined = []
    for module_key, facts in buckets.items():
        deduped = _dedupe_facts(facts)
        if not deduped:
            continue
        refined.append(
            {
                "module": module_key,
                "label": KNOWN_ARCHIVE_MODULES.get(module_key, skill_label(module_key)),
                "summary": f"已提炼 {len(deduped)} 条可复用事实。",
                "facts": deduped[:8],
            }
        )
    return refined


async def _store_refined_archive(
    session: AsyncSession,
    *,
    project_id: str,
    modules: list[dict[str, Any]],
    user_id: str | None,
    source_id: str | None,
) -> None:
    for module in modules:
        facts = [
            {
                "label": fact["label"],
                "value": fact["value"],
                "display": fact.get("display") or {"type": "text", "unit": "", "series": []},
                "source_labels": fact.get("source_labels") or [],
            }
            for fact in module.get("facts", [])
            if fact.get("label") and fact.get("value")
        ]
        if not facts:
            continue
        module_key = str(module.get("module") or "").strip()
        label = str(module.get("label") or KNOWN_ARCHIVE_MODULES.get(module_key) or skill_label(module_key)).strip()
        summary = str(module.get("summary") or f"{label}沉淀 {len(facts)} 条事实。").strip()
        entry = ProjectMemoryEntry(
            project_id=project_id,
            user_id=user_id,
            entry_type="archive_refinement",
            summary=f"智能提炼入档：{label}，{summary}",
            payload_json=json.dumps(
                {
                    "module": module_key,
                    "label": label,
                    "summary": summary,
                    "highlights": facts,
                    "source": "questionnaire_archive_refinement",
                },
                ensure_ascii=False,
            ),
            source_id=source_id,
        )
        session.add(entry)


def _route_module(text: str) -> str:
    lower = text.lower()
    rules = [
        ("retention_churn", ("留存", "流失", "复购", "续费", "退订", "召回", "沉默", "churn", "retention")),
        ("data_systems", ("api", "系统", "网关", "后台", "数据", "看板", "key", "sub2api", "余额", "口径")),
        ("market", ("官网", "竞品", "目标用户", "社媒", "获客", "投放", "外引流", "渠道入口")),
        ("product", ("产品", "功能", "体验", "兼容", "模型", "稳定性", "文档")),
        ("sales", ("线索", "转化", "成交", "注册", "销售", "漏斗")),
        ("finance", ("收入", "成本", "计费", "余额", "usd", "积分", "毛利", "价格")),
    ]
    for module, keywords in rules:
        if any(keyword in lower for keyword in keywords):
            return module
    cleaned = str(text or "").strip().split(" ", 1)[0]
    return cleaned if cleaned in KNOWN_ARCHIVE_MODULES else "market"


def _clean_label(value: Any) -> str:
    label = re.sub(r"\s+", "", str(value or "").strip("：:；;，, "))
    if label in LOW_VALUE_LABELS:
        return ""
    if "关键指标" in label or "关键验证点" in label:
        return ""
    return _rewrite_label(label, "")


def _rewrite_label(label: str, value: str) -> str:
    text = f"{label} {value}".lower()
    if any(token in text for token in ("http", "官网", "文档", "api")):
        return "核心入口链接"
    if any(token in text for token in ("注册", "配置", "调用", "key")):
        return "开发者首次路径"
    if any(token in text for token in ("留存", "流失", "复购", "回流")):
        return "留存与流失状态"
    if any(token in text for token in ("竞品", "对标")):
        return "竞品对标"
    return label[:16]


def _clean_value(value: Any) -> str:
    return " ".join(str(value or "").split()).strip("；;，, ")


def _compact_value(value: str, limit: int = 120) -> str:
    value = _clean_value(value)
    if len(value) <= limit:
        return value
    return value[:limit].rstrip("，,；; ") + "…"


def _infer_display(label: str, value: str) -> dict[str, Any]:
    text = f"{label} {value}".lower()
    if "http" in text:
        display_type = "link_list"
    elif any(token in text for token in ("注册", "配置", "调用", "转化", "漏斗")):
        display_type = "funnel"
    elif re.search(r"\d+[%％]|\d+\s*(天|月|人|个|元|usd)", text):
        display_type = "metric"
    elif "、" in value or "；" in value or "," in value:
        display_type = "list"
    else:
        display_type = "text"
    return {"type": display_type, "unit": "", "series": []}


def _normalize_display(display: Any, value: str) -> dict[str, Any]:
    if not isinstance(display, dict):
        return _infer_display("", value)
    display_type = str(display.get("type") or "text").strip()
    if display_type not in {"text", "metric", "list", "table", "trend", "funnel", "link_list"}:
        display_type = "text"
    return {
        "type": display_type,
        "unit": str(display.get("unit") or ""),
        "series": display.get("series") if isinstance(display.get("series"), list) else [],
    }


def _dedupe_facts(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    out = []
    for fact in facts:
        key = (fact["label"], fact["value"])
        if key in seen:
            continue
        seen.add(key)
        out.append(fact)
    return out
