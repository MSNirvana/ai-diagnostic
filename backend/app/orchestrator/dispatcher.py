import asyncio
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import ExpertRoute, ModuleResult, TriageConflict, TriageSummary
from app.skills.registry import get_skill, registered_modules
from app.filters.moat import scrub_method_language

MODULE_LABELS = {
    "market": "市场与客户",
    "product": "产品与服务",
    "sales": "销售与增长",
    "ops": "运营与供应链",
    "org": "组织与人才",
    "finance": "财务与资本",
}

KEYWORD_MODULES = {
    "sales": ("销售", "获客", "转化", "成交", "线索", "客户", "复购", "投放", "渠道"),
    "finance": ("现金流", "利润", "毛利", "亏损", "资金", "回款", "成本", "预算"),
    "product": ("产品", "服务", "交付物", "功能", "体验", "定价", "留存"),
    "ops": ("运营", "供应链", "交付", "库存", "产能", "生产效率", "交付效率", "流程"),
    "org": ("组织", "人才", "团队", "绩效", "激励", "招聘", "人效"),
    "market": ("市场", "竞品", "竞争", "行业", "定位", "客群"),
}

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
    routes = _route_experts(q)
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
    focus = str(problem_map.get("diagnosis_focus") or "").strip()
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
    parts: list[str] = []
    for key in ("core_problem", "goal", "constraints", "success_criteria", "context"):
        value = problem_map.get(key)
        if value:
            parts.append(str(value))
    for item in problem_map.get("sub_problems") or []:
        parts.append(str(item))
    return " ".join(parts)


def _keyword_modules(text: str) -> list[str]:
    modules: list[str] = []
    for module, keywords in KEYWORD_MODULES.items():
        if any(word in text for word in keywords):
            modules.append(module)
    return modules


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
                label=MODULE_LABELS.get(route.answer.module, route.answer.module),
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
    return conflicts


def _dependencies_for(results: list[ModuleResult]) -> list[str]:
    modules = {r.module for r in results}
    deps: list[str] = []
    if "market" in modules and "sales" in modules:
        deps.append("先确认目标客群与渠道质量，再优化销售转化动作。")
    if "finance" in modules and ("sales" in modules or "ops" in modules):
        deps.append("增长或运营动作需要先经过现金流与成本约束校验。")
    return deps


def _priority_actions(results: list[ModuleResult]) -> list[str]:
    actions: list[str] = []
    for result in results:
        label = MODULE_LABELS.get(result.module, result.module)
        for action in result.actions[:1]:
            actions.append(f"{label}：{action}")
    return actions[:5]
