import json
import re
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Project
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.orchestrator.dispatcher import _route_experts
from app.skills.parsing import parse_json_object
from app.skills.prompts import RESEARCH_PLANNER
from app.skills.skill_network import skill_label
from app.skills.scenario_catalog import detect_business_scenario, render_problem_text
from app.skills.store import get_active_skill_version

from .models import ResearchQuery
from .utils import (
    contains_any_term,
    contains_term,
    infer_query_intents,
    is_short_latin_term,
    merge_query_parts,
    normalize_text,
    significant_tokens,
    term_variants,
)


MAX_QUERIES_PER_MODULE = 5
RESEARCH_PLANNER_KEY = "research_planner"


@dataclass(frozen=True)
class ResearchScope:
    project_name: str = ""
    anchor_terms: tuple[str, ...] = ()
    problem_terms: tuple[str, ...] = ()
    entity_terms: tuple[str, ...] = ()
    business_terms: tuple[str, ...] = ()
    scenario_key: str = ""
    scenario_label: str = ""


def _modules_for(questionnaire: Questionnaire) -> list[str]:
    routes = _route_experts(questionnaire)
    modules = [route.answer.module for route in routes]
    if not modules:
        modules = [answer.module for answer in questionnaire.answers[:3]]
    return modules[:8]


async def build_research_scope(
    questionnaire: Questionnaire,
    session: AsyncSession | None = None,
) -> ResearchScope:
    problem_map = questionnaire.problem_map or {}
    scenario = detect_business_scenario(
        industry=str(problem_map.get("industry") or ""),
        main_business=str(problem_map.get("main_business") or ""),
        business_model=str(problem_map.get("business_model") or ""),
        extra_text=render_problem_text(problem_map),
    )

    project_name = ""
    project_identity_terms: list[str] = []
    project_business_terms: list[str] = []
    if session is not None and questionnaire.project_id:
        project = await session.get(Project, questionnaire.project_id)
        if project is not None:
            project_name = _clean_term(project.name)
            project_identity_terms.extend(_project_profile_values(project, (
                "company_name",
                "brand_name",
                "project_name",
                "aliases",
            )))
            project_business_terms.extend(_project_profile_values(project, (
                "industry",
                "main_business",
                "business_model",
                "product_name",
                "products",
                "core_problem",
                "goal",
            )))

    entity_terms = _dedupe_terms([
        project_name,
        *project_identity_terms,
        str(problem_map.get("company_name") or ""),
    ])
    business_terms = _dedupe_terms([
        *project_business_terms,
        str(problem_map.get("main_business") or ""),
        str(problem_map.get("industry") or ""),
        str(problem_map.get("business_model") or ""),
        scenario.label,
    ])
    anchor_terms = _dedupe_terms([*entity_terms, *business_terms])
    if not anchor_terms and questionnaire.project_id:
        anchor_terms = _dedupe_terms([project_name])

    problem_terms = _dedupe_terms([
        str(problem_map.get("core_problem") or ""),
        str(problem_map.get("goal") or ""),
        str(problem_map.get("constraints") or ""),
        str(problem_map.get("success_criteria") or ""),
        str(problem_map.get("impact") or ""),
        str(problem_map.get("suspected_cause") or ""),
        str(problem_map.get("tried") or ""),
        *(str(item) for item in (problem_map.get("sub_problems") or [])[:3]),
        skill_label(str(problem_map.get("diagnosis_focus") or "")),
    ])
    return ResearchScope(
        project_name=project_name,
        anchor_terms=tuple(anchor_terms),
        problem_terms=tuple(problem_terms),
        entity_terms=tuple(entity_terms),
        business_terms=tuple(business_terms),
        scenario_key=scenario.key,
        scenario_label=scenario.label,
    )


async def plan_research_queries(
    questionnaire: Questionnaire,
    llm: LLMClient | None = None,
    session: AsyncSession | None = None,
    *,
    scope: ResearchScope | None = None,
) -> list[ResearchQuery]:
    """规划外部研究查询：优先用 research_planner 脑子（LLM，按问题现想搜什么），
    无 llm / 无核心问题 / 失败 → 回退确定性规则模板。可版本化、不阻断。"""
    scope = scope or await build_research_scope(questionnaire, session)
    rule_based = plan_system_research_queries(questionnaire, scope=scope)
    problem_map = questionnaire.problem_map or {}
    if llm is None or not str(problem_map.get("core_problem") or "").strip():
        return rule_based

    system = RESEARCH_PLANNER
    ver = await get_active_skill_version(session, RESEARCH_PLANNER_KEY)
    if ver and ver.system_prompt.strip():
        system = ver.system_prompt
    payload = json.dumps(
        {
            "problem_map": problem_map,
            "modules": [{"key": m, "label": skill_label(m)} for m in _modules_for(questionnaire)],
            "project_name": scope.project_name,
            "anchor_terms": list(scope.anchor_terms[:6]),
            "problem_terms": list(scope.problem_terms[:6]),
        },
        ensure_ascii=False,
    )
    try:
        raw = await llm.complete(system=system, prompt=payload)
        data = parse_json_object(raw)
    except Exception:  # noqa: BLE001 — 规划失败不阻断，回退规则
        return rule_based

    out: list[ResearchQuery] = []
    for item in (data.get("queries") or [])[:12]:
        if not isinstance(item, dict):
            continue
        query = rewrite_query_for_scope(
            str(item.get("query") or ""),
            str(item.get("module") or ""),
            scope,
        )
        if not query:
            continue
        out.append(ResearchQuery(
            module=str(item.get("module") or ""),
            query=query,
            purpose=str(item.get("purpose") or "")[:120],
        ))
    scoped = _scope_queries(out, scope)
    return scoped or rule_based


def plan_system_research_queries(
    questionnaire: Questionnaire,
    *,
    scope: ResearchScope | None = None,
) -> list[ResearchQuery]:
    """Generate system pre-research queries before expert diagnosis.

    第一版用确定性规则，不额外消耗 LLM token。后续可升级为 planner Skill。
    """
    problem_map = questionnaire.problem_map or {}
    scope = scope or ResearchScope(
        project_name="",
        entity_terms=tuple(_dedupe_terms([
            str(problem_map.get("company_name") or ""),
        ])),
        business_terms=tuple(_dedupe_terms([
            str(problem_map.get("main_business") or ""),
            str(problem_map.get("industry") or ""),
            str(problem_map.get("business_model") or ""),
        ])),
        anchor_terms=tuple(_dedupe_terms([
            str(problem_map.get("company_name") or ""),
            str(problem_map.get("main_business") or ""),
            str(problem_map.get("industry") or ""),
            str(problem_map.get("business_model") or ""),
        ])),
        problem_terms=tuple(_dedupe_terms([
            str(problem_map.get("core_problem") or ""),
            str(problem_map.get("goal") or ""),
            str(problem_map.get("constraints") or ""),
            str(problem_map.get("suspected_cause") or ""),
            str(problem_map.get("tried") or ""),
            *(str(item) for item in (problem_map.get("sub_problems") or [])[:3]),
        ])),
    )
    routes = _route_experts(questionnaire)
    modules = [route.answer.module for route in routes]
    if not modules:
        modules = [answer.module for answer in questionnaire.answers[:3]]

    queries: list[ResearchQuery] = []

    for module in modules[:8]:
        label = skill_label(module)
        seeds = _module_query_templates(module, label, scope)
        for query, purpose in seeds[:MAX_QUERIES_PER_MODULE]:
            cleaned = rewrite_query_for_scope(query, module, scope)
            if cleaned and _query_matches_scope(cleaned, module, scope):
                queries.append(ResearchQuery(module=module, query=cleaned, purpose=purpose))

    return _dedupe_queries(queries)


def _module_query_templates(
    module: str,
    label: str,
    scope: ResearchScope,
) -> list[tuple[str, str]]:
    anchor = _primary_anchor(scope) or label
    secondary = _secondary_anchor(scope) or anchor
    business = _primary_business(scope) or secondary or anchor
    problem = _primary_problem(scope) or label
    topics = _module_topics(module, label)
    windows = _module_windows(module)
    queries: list[tuple[str, str]] = []
    for topic in topics[:3]:
        for window in windows[:2]:
            queries.append((f"{anchor} {topic} {window}", f"核验{label}相关公开证据"))
        if problem:
            queries.append((f"{secondary} {problem} {topic}", f"围绕核心问题核验{label}"))
        if business:
            queries.append((f"{business} {topic} {_benchmark_window(module)}", f"补齐{label}行业基准"))
            if problem:
                queries.append((f"{business} {problem} {_case_window(module)}", f"围绕核心问题寻找{label}可比案例"))
    if scope.project_name and scope.project_name not in anchor:
        queries.append((f"{scope.project_name} {topics[0]} 公开信息", f"补齐项目实体公开信息"))
    if _needs_global_variant(scope):
        queries.append((f"{scope.project_name} official website", "核验项目英文官网"))
        if module in {"market", "product", "channel_franchise"}:
            queries.append((f"{scope.project_name} reviews", "核验项目英文公开评价"))
    return queries


def _dedupe_queries(queries: list[ResearchQuery]) -> list[ResearchQuery]:
    seen: set[tuple[str, str]] = set()
    out: list[ResearchQuery] = []
    for query in queries:
        key = (query.module, query.query)
        if key in seen:
            continue
        seen.add(key)
        out.append(query)
    return out


def _scope_queries(queries: list[ResearchQuery], scope: ResearchScope) -> list[ResearchQuery]:
    if not queries:
        return []
    out: list[ResearchQuery] = []
    for query in queries:
        score = _query_relevance_score(query.query, query.module, scope)
        if score < 3:
            continue
        out.append(query)
    return _dedupe_queries(out)


def _query_matches_scope(query: str, module: str, scope: ResearchScope) -> bool:
    return _query_relevance_score(query, module, scope) >= 3


def _query_relevance_score(query: str, module: str, scope: ResearchScope) -> int:
    normalized = _normalize(query)
    intents = infer_query_intents(query)
    score = 0
    has_entity = contains_any_term(query, scope.entity_terms[:6])
    has_business = contains_any_term(query, scope.business_terms[:6])
    if scope.entity_terms and not has_entity and not has_business:
        return 0
    if has_entity:
        score += 4
    if has_business:
        score += 3
    if any(term and term in normalized for term in [_normalize(value) for value in _module_topics(module, skill_label(module))]):
        score += 2
    if any(term and term in normalized for term in [_normalize(value) for value in _module_windows(module)]):
        score += 1
    if any(term and term in normalized for term in [_normalize(value) for value in scope.problem_terms if value.strip()]):
        score += 2
    if scope.project_name and _normalize(scope.project_name) in normalized:
        score += 2
    if len(significant_tokens(query)) >= 3:
        score += 1
    if intents & {"benchmark", "policy", "reputation", "competition", "official"}:
        score += 1
    return score


def _primary_anchor(scope: ResearchScope) -> str:
    return scope.anchor_terms[0] if scope.anchor_terms else ""


def _secondary_anchor(scope: ResearchScope) -> str:
    return scope.anchor_terms[1] if len(scope.anchor_terms) > 1 else ""


def _primary_problem(scope: ResearchScope) -> str:
    return scope.problem_terms[0] if scope.problem_terms else ""


def _primary_business(scope: ResearchScope) -> str:
    if not scope.business_terms:
        return ""
    return max(scope.business_terms[:3], key=len)


def rewrite_query_for_scope(query: str, module: str, scope: ResearchScope) -> str:
    base = _clean_term(query)
    if not base:
        return ""
    intents = infer_query_intents(base)
    parts: list[str] = [base]
    entity_terms = scope.entity_terms[:6]
    business_terms = scope.business_terms[:6]
    module_topics = _module_topics(module, skill_label(module))

    if entity_terms and not contains_any_term(base, entity_terms):
        if not (intents & {"benchmark", "policy", "competition"} and contains_any_term(base, business_terms)):
            parts.insert(0, entity_terms[0])

    current = " ".join(parts)
    if business_terms and not contains_any_term(current, business_terms):
        if (
            any(is_short_latin_term(term) for term in entity_terms)
            or is_short_latin_term(scope.project_name)
            or len(significant_tokens(current)) < 3
            or intents & {"benchmark", "policy", "competition"}
        ):
            parts.append(business_terms[0])

    current = " ".join(parts)
    primary_problem = _primary_problem(scope)
    if primary_problem and not contains_term(current, primary_problem):
        if intents & {"benchmark", "policy", "competition"} or len(significant_tokens(current)) < 3:
            parts.append(primary_problem)

    current = " ".join(parts)
    if module_topics and not contains_any_term(current, module_topics[:3]):
        parts.append(module_topics[0])

    current = " ".join(parts)
    windows = _module_windows(module)
    if windows and len(significant_tokens(current)) < 3:
        parts.append(windows[0])

    return merge_query_parts(parts, max_len=180)


def _module_topics(module: str, label: str) -> tuple[str, ...]:
    topics = {
        "market": ("招商", "客户", "口碑", "竞品"),
        "sales": ("转化", "线索", "成交", "回款"),
        "product": ("产品", "服务", "体验", "评价"),
        "ops": ("交付", "供应链", "产能", "库存"),
        "org": ("组织", "团队", "人效", "激励"),
        "finance": ("毛利", "现金流", "回本周期", "利润"),
        "legal_compliance": ("资质", "合规", "广告法", "合同"),
        "tax": ("发票", "税务", "申报", "抵扣"),
        "policy": ("政策", "补贴", "监管", "准入"),
        "ip": ("商标", "专利", "知识产权", "侵权"),
        "supply_chain": ("供应商", "交付", "库存", "成本"),
        "channel_franchise": ("加盟", "招商", "单店模型", "回本周期"),
        "data_systems": ("CRM", "ERP", "看板", "指标口径"),
    }.get(module, ())
    if label and label not in topics:
        topics = (*topics, label)
    return topics or (label,)


def _module_windows(module: str) -> tuple[str, ...]:
    windows = {
        "market": ("官网", "招商页", "公开评价", "用户反馈"),
        "sales": ("CRM", "成交", "回款", "漏斗"),
        "product": ("官网", "产品页", "公开评价", "测评"),
        "ops": ("交付", "履约", "产能", "库存"),
        "finance": ("财报", "回款", "现金流", "毛利"),
        "legal_compliance": ("资质", "处罚", "监管", "广告法"),
        "tax": ("发票", "申报", "税务", "抵扣"),
        "policy": ("政策", "通知", "补贴", "准入"),
        "ip": ("商标", "专利", "知识产权", "侵权"),
        "supply_chain": ("供应商", "交付", "采购", "成本"),
        "channel_franchise": ("加盟", "招商", "回本周期", "单店模型"),
        "data_systems": ("CRM", "ERP", "看板", "指标口径"),
    }.get(module, ())
    return windows or ("官网", "公开评价", "竞品")


def _benchmark_window(module: str) -> str:
    return {
        "policy": "政策监管",
        "legal_compliance": "处罚案例",
        "finance": "行业基准",
        "channel_franchise": "单店模型",
        "product": "公开评价",
        "market": "行业基准",
    }.get(module, "行业基准")


def _case_window(module: str) -> str:
    return {
        "policy": "监管案例",
        "legal_compliance": "处罚案例",
        "finance": "可比案例",
        "channel_franchise": "招商案例",
        "product": "用户评价",
        "market": "竞品案例",
    }.get(module, "可比案例")


def _needs_global_variant(scope: ResearchScope) -> bool:
    return bool(scope.project_name and re.search(r"[A-Za-z]", scope.project_name))


def _project_profile_values(project: Project, keys: tuple[str, ...]) -> list[str]:
    terms = [project.name]
    raw = project.profile_json or ""
    if not raw.strip():
        return _dedupe_terms(terms)
    try:
        payload = json.loads(raw)
    except Exception:  # noqa: BLE001
        return _dedupe_terms(terms)
    if not isinstance(payload, dict):
        return _dedupe_terms(terms)
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            terms.append(value)
        elif isinstance(value, list):
            terms.extend(str(item) for item in value[:3] if str(item).strip())
    return _dedupe_terms(terms)


def _dedupe_terms(values: list[str] | tuple[str, ...]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        for candidate in term_variants(value):
            clean = _clean_term(candidate)
            if not clean or clean in seen:
                continue
            seen.add(clean)
            out.append(clean)
    return out


def _clean_term(value: str) -> str:
    return " ".join(str(value).split()).strip()


def _normalize(value: str) -> str:
    return re.sub(r"\s+", "", str(value)).lower()
