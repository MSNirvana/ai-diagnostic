import asyncio
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import ExpertRoute, ModuleResult, TriageConflict, TriageSummary
from app.skills.registry import get_skill, registered_modules
from app.skills.scenario_catalog import detect_business_scenario, render_problem_text
from app.skills.skill_network import resolve_skill_key, skill_keys_from_text, skill_label
from app.skills.skill_network import _score_definitions
from app.filters.moat import scrub_method_language
from app.orchestrator.routing_collector import collect_routing_sample

SIGNAL_WEIGHT = {"red": 0, "yellow": 1, "green": 2}


@dataclass
class DiagnoseOutcome:
    results: list[ModuleResult]
    skill_version_ids: dict[str, str]   # {module: skill_version_id}
    triage: TriageSummary


async def diagnose_all(
    q: Questionnaire,
    llm: LLMClient,
    session: AsyncSession | None = None,
) -> DiagnoseOutcome:
    """读问卷 -> 对每个有对应 skill 的模块并行诊断 -> 护城河过滤后汇总。

    同时收集每个模块用了哪个 skill 版本（供反馈关联）。
    """
    questionnaire = _hydrate_answer_contexts(q)
    routes = _route_experts(questionnaire)
    modules: list[str] = []
    tasks = []
    for route in routes:
        answer = route.answer
        skill = get_skill(answer.module)
        if skill is not None:
            modules.append(answer.module)
            tasks.append(skill.diagnose(answer, llm, session))

    pairs = await asyncio.gather(*tasks)  # list[(ModuleResult, version_id)]

    results: list[ModuleResult] = []
    version_ids: dict[str, str] = {}
    for module, (result, version_id) in zip(modules, pairs):
        results.append(scrub_method_language(result))
        version_ids[module] = version_id
    triage = _summarize_triage(routes, results)

    # Loop 2：best-effort 记一条路由样本（失败不影响诊断）
    problem_text = _problem_text(questionnaire.problem_map or {})
    scenario_key = ""
    if questionnaire.answers:
        scenario_key = str(questionnaire.answers[0].context.get("scenario_key", ""))
    await collect_routing_sample(
        session,
        record_id=None,
        problem_text=problem_text,
        scenario_key=scenario_key,
        routes=routes,
        results=results,
        recall_scores=_score_definitions(problem_text),
    )

    return DiagnoseOutcome(results=results, skill_version_ids=version_ids, triage=triage)


@dataclass(frozen=True)
class _Route:
    answer: ModuleAnswer
    reason: str
    priority: int


def _route_experts(q: Questionnaire) -> list[_Route]:
    by_module = {answer.module: answer for answer in q.answers}
    selected: dict[str, _Route] = {}

    for order, answer in enumerate(q.answers):
        if get_skill(answer.module) is not None:
            selected[answer.module] = _Route(answer, "用户填写了该模块", 10 + order)

    problem_map = q.problem_map or {}
    focus = resolve_skill_key(str(problem_map.get("diagnosis_focus") or ""))
    if focus and get_skill(focus) is not None:
        selected[focus] = _Route(
            by_module.get(focus) or ModuleAnswer(module=focus),
            "问题地图建议优先诊断",
            0,
        )

    problem_text = _problem_text(problem_map)
    for module in _keyword_modules(problem_text):
        selected.setdefault(
            module,
            _Route(
                by_module.get(module) or ModuleAnswer(module=module),
                "问题地图提到相关经营信号",
                20 + len(selected),
            ),
        )

    valid_modules = set(registered_modules())
    routes = [r for r in selected.values() if r.answer.module in valid_modules]
    routes.sort(key=lambda r: (r.priority, r.answer.module))
    return routes


def _problem_text(problem_map: dict) -> str:
    return render_problem_text(problem_map)


def _keyword_modules(text: str) -> list[str]:
    return skill_keys_from_text(text)


def _summarize_triage(routes: list[_Route], results: list[ModuleResult]) -> TriageSummary:
    if not routes:
        return TriageSummary()

    ranked = sorted(results, key=lambda r: (SIGNAL_WEIGHT.get(r.signal, 9), _route_priority(routes, r.module)))
    primary = ranked[0].module if ranked else routes[0].answer.module
    conflicts = _detect_conflicts(results)
    dependencies = _dependencies_for(results)
    priority_actions = _priority_actions(ranked)

    return TriageSummary(
        primary_module=primary,
        selected_experts=[
            ExpertRoute(
                module=route.answer.module,
                label=skill_label(route.answer.module),
                reason=route.reason,
                priority=route.priority,
            )
            for route in routes
        ],
        conflicts=conflicts,
        dependencies=dependencies,
        priority_actions=priority_actions,
    )


def _route_priority(routes: list[_Route], module: str) -> int:
    for route in routes:
        if route.answer.module == module:
            return route.priority
    return 99


def _detect_conflicts(results: list[ModuleResult]) -> list[TriageConflict]:
    modules = {r.module: r for r in results}
    conflicts: list[TriageConflict] = []
    sales = modules.get("sales")
    finance = modules.get("finance")
    if sales and finance and sales.signal in ("red", "yellow") and finance.signal == "green":
        conflicts.append(
            TriageConflict(
                modules=["sales", "finance"],
                description="销售与增长提示需要优先处理，但财务与资本暂未显示同等压力；行动节奏需要避免过度投入。",
            )
        )
    if sales and finance and sales.signal == "red" and finance.signal in ("red", "yellow"):
        conflicts.append(
            TriageConflict(
                modules=["sales", "finance"],
                description="销售与增长需要投入改善转化，但财务与资本提示现金流或成本约束，需先设定投入上限。",
            )
        )
    legal = modules.get("legal_compliance")
    if legal and legal.signal in ("red", "yellow"):
        growth_modules = [
            module for module in ("market", "sales", "channel_franchise")
            if module in modules and modules[module].signal in ("red", "yellow")
        ]
        if growth_modules:
            conflicts.append(
                TriageConflict(
                    modules=[*growth_modules[:2], "legal_compliance"],
                    description="增长或渠道动作存在合规前置约束，需先确认宣传、资质、合同和平台规则边界。",
                )
            )
    tax = modules.get("tax")
    finance = modules.get("finance")
    if tax and finance and tax.signal in ("red", "yellow") and finance.signal in ("red", "yellow"):
        conflicts.append(
            TriageConflict(
                modules=["finance", "tax"],
                description="财务改善动作需要同步校验税负、发票和合同/资金/票据一致性，避免利润修复带来税务风险。",
            )
        )
    return conflicts


def _dependencies_for(results: list[ModuleResult]) -> list[str]:
    modules = {r.module for r in results}
    deps: list[str] = []
    if "market" in modules and "sales" in modules:
        deps.append("先确认目标客群与渠道质量，再优化销售转化动作。")
    if "finance" in modules and ("sales" in modules or "ops" in modules):
        deps.append("增长或运营动作需要先经过现金流与成本约束校验。")
    if "legal_compliance" in modules and ("market" in modules or "sales" in modules or "channel_franchise" in modules):
        deps.append("投放、销售、招商或加盟动作上线前，先完成资质、合同和宣传口径合规校验。")
    if "tax" in modules and "finance" in modules:
        deps.append("财务测算需要同步核对发票链路、税负和收入确认口径。")
    if "ip" in modules and ("product" in modules or "channel_franchise" in modules):
        deps.append("产品、授权或渠道扩张前，先确认商标、专利、版权和授权边界。")
    if "data_systems" in modules:
        deps.append("所有复盘指标需要先统一数据口径和系统责任人，否则作战室无法持续迭代。")
    return deps


def _priority_actions(results: list[ModuleResult]) -> list[str]:
    actions: list[str] = []
    for result in results:
        label = skill_label(result.module)
        for action in result.actions[:1]:
            actions.append(f"{label}：{action}")
    return actions[:5]


def _hydrate_answer_contexts(q: Questionnaire) -> Questionnaire:
    problem_map = q.problem_map or {}
    scenario = detect_business_scenario(
        industry=str(problem_map.get("industry") or ""),
        main_business=str(problem_map.get("main_business") or ""),
        business_model=str(problem_map.get("business_model") or ""),
        extra_text=render_problem_text(problem_map),
    )
    shared_context = {
        "company_name": str(problem_map.get("company_name") or ""),
        "industry": str(problem_map.get("industry") or ""),
        "main_business": str(problem_map.get("main_business") or ""),
        "business_model": str(problem_map.get("business_model") or ""),
        "scale": str(problem_map.get("scale") or ""),
        "stage": str(problem_map.get("stage") or ""),
        "core_problem": str(problem_map.get("core_problem") or ""),
        "goal": str(problem_map.get("goal") or ""),
        "constraints": str(problem_map.get("constraints") or ""),
        "success_criteria": str(problem_map.get("success_criteria") or ""),
        "impact": str(problem_map.get("impact") or ""),
        "context": str(problem_map.get("context") or ""),
        "suspected_cause": str(problem_map.get("suspected_cause") or ""),
        "tried": str(problem_map.get("tried") or ""),
        "data_readiness": str(problem_map.get("data_readiness") or ""),
        "diagnosis_focus": str(problem_map.get("diagnosis_focus") or ""),
        "scenario_key": scenario.key,
        "scenario_label": scenario.label,
    }
    hydrated_answers = [
        answer.model_copy(update={"context": {**shared_context, **answer.context}})
        for answer in q.answers
    ]
    return q.model_copy(update={"answers": hydrated_answers})
