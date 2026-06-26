import asyncio
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import ExpertRoute, ModuleResult, TriageConflict, TriageSummary
from app.skills.registry import get_skill, registered_modules
from app.skills.scenario_catalog import detect_business_scenario, render_problem_text
from app.skills.skill_network import resolve_skill_key, skill_keys_from_text, skill_label
from app.skills.skill_network import _score_definitions, diagnosis_skill_definitions
from app.filters.moat import scrub_method_language
from app.orchestrator.routing_collector import collect_routing_sample
from app.orchestrator.scout import adhoc_skill, scout_angles
from app.warroom.history import build_feedback_digest

SIGNAL_WEIGHT = {"red": 0, "yellow": 1, "green": 2}

# 路由来源（用于「scout 权威路由」：纯关键词命中的、scout 没采纳又没人填的，剔除掉省算力）
_REASON_ANSWERED = "用户填写了该模块"
_REASON_FOCUS = "问题地图建议优先诊断"
_REASON_KEYWORD = "问题地图提到相关经营信号"


@dataclass
class DiagnoseOutcome:
    results: list[ModuleResult]
    skill_version_ids: dict[str, str]   # {module: skill_version_id}
    triage: TriageSummary


async def diagnose_all(
    q: Questionnaire,
    llm: LLMClient,
    session: AsyncSession | None = None,
    research_evidence: list[dict] | None = None,
) -> DiagnoseOutcome:
    """读问卷 -> 对每个有对应 skill 的模块并行诊断 -> 护城河过滤后汇总。

    同时收集每个模块用了哪个 skill 版本（供反馈关联）。
    """
    # 反馈闭环：把项目历次作战室反馈当上下文喂进本轮（无效别重复、无变化重做约束定位、有新问题纳入）。best-effort。
    feedback_digest = await build_feedback_digest(session, getattr(q, "project_id", None))
    if feedback_digest:
        q = q.model_copy(update={"problem_map": {**(q.problem_map or {}), "prior_feedback": feedback_digest}})
    questionnaire = _hydrate_answer_contexts(q, research_evidence=research_evidence or [])
    base_routes = list(_route_experts(questionnaire))

    # 调度脑子先跑，拿到本次「相关域」集合（best-effort，失败/无核心问题返回 []）。
    problem_map = questionnaire.problem_map or {}
    known = [(d.key, d.label) for d in diagnosis_skill_definitions()]
    angles = await scout_angles(problem_map, known, llm, session)

    # 权威路由：scout 跑了，就只跑「scout 采纳 / 诊断焦点 / 用户真填了数据」的域；
    # 其余（关键词投机命中、或旧问卷生成但用户没填的空壳模块）一律不跑——省算力，也不让无关域污染结果。
    # scout 没跑（无核心问题/失败）则退回原行为，绝不漏诊。
    if angles:
        endorsed = {a.module for a in angles if a.known}
        routes = [
            r for r in base_routes
            if r.answer.module in endorsed
            or r.reason == _REASON_FOCUS
            or _has_user_data(r.answer)
        ]
    else:
        routes = base_routes

    # 给所有最终路由（含关键词/焦点合成的空 answer）注入共享上下文，确保每个被诊断的域都看到
    # 完整问题背景（含 prior_feedback）——之前合成 answer 的 context 是空的，会让这些域半盲诊断。
    shared_ctx = _build_shared_context(questionnaire.problem_map or {}, research_evidence or [])
    routes = [
        _Route(
            r.answer.model_copy(update={"context": {**shared_ctx, **(r.answer.context or {})}}),
            r.reason,
            r.priority,
        )
        for r in routes
    ]

    modules: list[str] = []
    tasks = []
    for route in routes:
        answer = route.answer
        skill = get_skill(answer.module)
        if skill is not None:
            modules.append(answer.module)
            tasks.append(skill.diagnose(answer, llm, session))

    # 起跑库不设边界：把 scout 采纳的、还没在 routes 里的已有域 + 注册表外新角度补进来。
    extra_modules, extra_tasks, extra_routes = _scout_apply(
        questionnaire,
        angles,
        already=set(modules),
        llm=llm,
        session=session,
        research_evidence=research_evidence or [],
    )
    modules += extra_modules
    tasks += extra_tasks
    routes = list(routes) + extra_routes

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


def _scout_apply(
    questionnaire: Questionnaire,
    angles: list,
    *,
    already: set[str],
    llm: LLMClient,
    session: AsyncSession | None,
    research_evidence: list[dict],
):
    """把调度脑子采纳的额外角度变成诊断任务 → (modules, tasks, routes)。

    - known 角度：走注册表（复用其 KPI/取数项/负责人/基准），沿用已填问卷数据或合成空 answer。
    - 新角度：现场建 ad-hoc 域，脑子按 label + 问题上下文诊断（无人填数据→诚实降置信并提数据请求）。
    angles 由 diagnose_all 预先算好传入，避免二次调用 LLM。
    """
    if not angles:
        return [], [], []
    problem_map = questionnaire.problem_map or {}
    shared = _build_shared_context(problem_map, research_evidence)
    by_module = {answer.module: answer for answer in questionnaire.answers}

    def _synth(module: str) -> ModuleAnswer:
        # 用 model_copy 注入共享上下文（含 research_evidence 列表），与 _hydrate 一致地绕过逐字段校验。
        return ModuleAnswer(module=module).model_copy(update={"context": dict(shared)})

    ex_modules: list[str] = []
    ex_tasks: list = []
    ex_routes: list = []
    for angle in angles:
        if angle.module in already:
            continue
        if angle.known:
            skill = get_skill(angle.module)
            if skill is None:
                continue
            answer = by_module.get(angle.module) or _synth(angle.module)
        else:
            skill = adhoc_skill(angle.label)
            answer = _synth(angle.module)
        already.add(angle.module)
        ex_modules.append(angle.module)
        ex_tasks.append(skill.diagnose(answer, llm, session))
        ex_routes.append(
            _Route(answer, f"调度脑子建议诊断：{angle.reason or angle.label}", 30 + len(ex_routes))
        )
    return ex_modules, ex_tasks, ex_routes


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
            selected[answer.module] = _Route(answer, _REASON_ANSWERED, 10 + order)

    problem_map = q.problem_map or {}
    focus = resolve_skill_key(str(problem_map.get("diagnosis_focus") or ""))
    if focus and get_skill(focus) is not None:
        selected[focus] = _Route(
            by_module.get(focus) or ModuleAnswer(module=focus),
            _REASON_FOCUS,
            0,
        )

    problem_text = _problem_text(problem_map)
    for module in _keyword_modules(problem_text):
        selected.setdefault(
            module,
            _Route(
                by_module.get(module) or ModuleAnswer(module=module),
                _REASON_KEYWORD,
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


def _has_user_data(answer: ModuleAnswer) -> bool:
    """用户是否真给了这个域数据（填了字段或勾了痛点）——给了就尊重、必跑，不被 scout 否决。"""
    return bool(answer.facts) or bool(answer.pains)


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


def _build_shared_context(
    problem_map: dict,
    research_evidence: list[dict] | None = None,
) -> dict:
    """问题地图 + 场景 → 注入每个 answer 的共享上下文（含调度脑子新增角度的合成 answer）。"""
    scenario = detect_business_scenario(
        industry=str(problem_map.get("industry") or ""),
        main_business=str(problem_map.get("main_business") or ""),
        business_model=str(problem_map.get("business_model") or ""),
        extra_text=render_problem_text(problem_map),
    )
    return {
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
        "prior_feedback": str(problem_map.get("prior_feedback") or ""),
        "scenario_key": scenario.key,
        "scenario_label": scenario.label,
        "research_evidence": research_evidence or [],
    }


def _hydrate_answer_contexts(
    q: Questionnaire,
    *,
    research_evidence: list[dict] | None = None,
) -> Questionnaire:
    shared_context = _build_shared_context(q.problem_map or {}, research_evidence or [])
    hydrated_answers = [
        answer.model_copy(update={"context": {**shared_context, **answer.context}})
        for answer in q.answers
    ]
    return q.model_copy(update={"answers": hydrated_answers})
