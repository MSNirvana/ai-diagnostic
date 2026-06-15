from uuid import uuid4

from app.models.questionnaire import Questionnaire
from app.models.result import DataRequest, ModuleResult, TriageSummary
from app.models.warroom import (
    ActionMetric,
    BattleChainStep,
    DecisionItem,
    DepartmentAction,
    PriorityBoard,
    ReviewCheckpoint,
    WarRoomPlan,
)
from app.skills.skill_network import skill_label

OWNER_ROLES = {
    "market": "市场负责人",
    "product": "产品负责人",
    "sales": "销售负责人",
    "ops": "运营负责人",
    "org": "HR / 组织负责人",
    "finance": "财务负责人",
    "legal_compliance": "法务 / 合规负责人",
    "tax": "财务 / 税务负责人",
    "policy": "政策事务负责人",
    "ip": "知识产权负责人",
    "supply_chain": "供应链负责人",
    "channel_franchise": "渠道负责人",
    "data_systems": "数据 / 信息化负责人",
}

ACTION_METRICS = {
    "market": ActionMetric(name="有效线索成本", target="两周内识别并压降低效渠道", direction="down"),
    "product": ActionMetric(name="关键需求命中率", target="30 天内提升核心客户反馈质量", direction="up"),
    "sales": ActionMetric(name="高质量线索成交率", target="30 天内出现可复盘改善", direction="up"),
    "ops": ActionMetric(name="交付准时率", target="两周内暴露并处理主要交付卡点", direction="up"),
    "org": ActionMetric(name="关键岗位人效", target="30 天内明确责任与激励口径", direction="up"),
    "finance": ActionMetric(name="预算偏差", target="两周内建立投入上限与复盘节奏", direction="down"),
    "legal_compliance": ActionMetric(name="合规风险清单关闭率", target="两周内完成高风险项确认", direction="down"),
    "tax": ActionMetric(name="税务资料完整率", target="两周内补齐票据与申报口径", direction="up"),
    "policy": ActionMetric(name="政策匹配项", target="30 天内确认可申报/需规避事项", direction="stable"),
    "ip": ActionMetric(name="核心资产保护率", target="30 天内补齐重点权属材料", direction="up"),
    "supply_chain": ActionMetric(name="关键物料风险项", target="两周内形成替代与安全库存方案", direction="down"),
    "channel_franchise": ActionMetric(name="渠道单元模型完整率", target="30 天内跑通样板渠道复盘", direction="up"),
    "data_systems": ActionMetric(name="核心指标可追踪率", target="两周内建立最小经营看板", direction="up"),
}

CHAIN_LABELS = {
    "market": "市场清渠道",
    "product": "产品校准价值主张",
    "sales": "销售重分线索",
    "ops": "运营补承接",
    "org": "组织定责任",
    "finance": "财务设预算红线",
    "legal_compliance": "合规先清红线",
    "tax": "税务核票据链",
    "policy": "政策定边界",
    "ip": "知识产权补保护",
    "supply_chain": "供应链稳供给",
    "channel_franchise": "渠道校准模型",
    "data_systems": "数据统一口径",
}

SIGNAL_WEIGHT = {"red": 0, "yellow": 1, "green": 2}


def _metric_for(module: str) -> ActionMetric:
    """取部门动作的核心指标。优先级：
    1) composer 手工映射 ACTION_METRICS（核心六模块+专业类，措辞最贴）
    2) skill config 声明的 industry_kpis 第一个（Loop 1 产出的行业 skill 自动有指标）
    3) 通用占位（最后兜底）

    这样 Loop 1 跑批出的 100 个行业 skill 不用回来手维护字典，自带像样指标。
    """
    if module in ACTION_METRICS:
        return ACTION_METRICS[module]
    try:
        from app.skills.config_loader import load_config_meta
        kpis = load_config_meta(module).get("industry_kpis") or []
        if kpis:
            return ActionMetric(name=kpis[0], target="30 天内出现可复盘改善", direction="stable")
    except Exception:  # noqa: BLE001 — 取不到就走通用兜底
        pass
    return ActionMetric(name="核心指标", target="下次复盘可量化", direction="stable")


def compose_war_room_plan(
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    triage: TriageSummary,
    skill_version_ids: dict[str, str],
    record_id: str | None = None,
) -> WarRoomPlan:
    """把专家会诊结果转成老板能拿去开会的部门作战方案。"""
    del skill_version_ids
    primary = _primary_battlefield(results, triage)
    secondary = _secondary_battlefield(results, triage, primary)
    ordered_results = _ordered_results(results, primary, secondary)
    data_gaps = _dedupe_data_requests(ordered_results)
    actions = _department_actions(ordered_results, primary, secondary)

    return WarRoomPlan(
        id=f"wr_{uuid4().hex[:12]}",
        record_id=record_id,
        project_id=questionnaire.project_id,
        source_record_ids=[record_id] if record_id else [],
        iteration_count=1 if record_id else 0,
        iterations=[],
        summary=_summary(results, primary, secondary, bool(data_gaps)),
        primary_battlefield=primary,
        secondary_battlefield=secondary,
        objective=_objective(questionnaire, results, primary),
        confidence=_overall_confidence(results, primary, secondary, data_gaps),
        decision_items=_decision_items(actions, primary, data_gaps),
        battle_chain=_battle_chain(ordered_results, primary, secondary, triage),
        department_actions=actions,
        priority_board=_priority_board(actions),
        evidence_summary=_evidence_summary(ordered_results, primary, secondary),
        risk_summary=_risk_summary(triage, ordered_results, data_gaps),
        data_gaps=data_gaps,
        checkpoints=_checkpoints(primary),
    )


def _primary_battlefield(results: list[ModuleResult], triage: TriageSummary) -> str:
    if triage.primary_module:
        return triage.primary_module
    if not results:
        return "overall"
    return sorted(results, key=lambda result: SIGNAL_WEIGHT.get(result.signal, 9))[0].module


def _secondary_battlefield(
    results: list[ModuleResult], triage: TriageSummary, primary: str
) -> str:
    result_modules = {result.module for result in results}
    for route in triage.selected_experts:
        if route.module != primary and route.module in result_modules:
            return route.module
    for result in sorted(results, key=lambda item: SIGNAL_WEIGHT.get(item.signal, 9)):
        if result.module != primary:
            return result.module
    return ""


def _ordered_results(
    results: list[ModuleResult], primary: str, secondary: str
) -> list[ModuleResult]:
    return sorted(
        results,
        key=lambda result: (
            0 if result.module == primary else 1 if result.module == secondary else 2,
            SIGNAL_WEIGHT.get(result.signal, 9),
        ),
    )


def _summary(
    results: list[ModuleResult], primary: str, secondary: str, has_data_gap: bool
) -> str:
    if not results:
        return "当前输入不足，建议先补齐经营数据，再生成完整部门作战方案。"
    primary_label = skill_label(primary)
    secondary_label = skill_label(secondary)
    primary_result = _find_result(results, primary)
    conclusion = primary_result.conclusion if primary_result else "核心经营瓶颈"
    if secondary:
        summary = f"未来 30 天优先打{primary_label}战，次战场关注{secondary_label}，把「{conclusion}」转成部门动作。"
    else:
        summary = f"未来 30 天优先打{primary_label}战，先把「{conclusion}」转成可执行动作。"
    if has_data_gap:
        return f"{summary} 当前为保守版方案，需补齐关键数据后复核。"
    return summary


def _objective(questionnaire: Questionnaire, results: list[ModuleResult], primary: str) -> str:
    problem_map = questionnaire.problem_map or {}
    goal = str(problem_map.get("goal") or "").strip()
    if goal:
        return goal
    primary_result = _find_result(results, primary)
    if primary_result:
        return f"30 天内改善：{primary_result.conclusion}"
    return "补齐关键经营输入，形成可复盘的本期作战目标"


def _overall_confidence(
    results: list[ModuleResult],
    primary: str,
    secondary: str,
    data_gaps: list[DataRequest],
) -> float:
    candidates = [
        result.evidence_package.confidence
        for result in results
        if result.module in {primary, secondary} and result.evidence_package is not None
    ]
    if not candidates:
        candidates = [
            result.evidence_package.confidence
            for result in results
            if result.evidence_package is not None
        ]
    if not candidates:
        return 0
    confidence = sum(candidates) / len(candidates)
    required_gap_count = len([gap for gap in data_gaps if gap.required])
    if required_gap_count >= 3:
        confidence -= 0.12
    elif required_gap_count:
        confidence -= 0.05
    return round(max(0, min(1, confidence)), 2)


def _department_actions(
    results: list[ModuleResult], primary: str, secondary: str
) -> list[DepartmentAction]:
    actions: list[DepartmentAction] = []
    for result in results[:10]:
        priority = _priority_for(result, primary, secondary)
        confidence = (
            result.evidence_package.confidence if result.evidence_package is not None else None
        )
        confidence_reason = (
            result.evidence_package.confidence_reason if result.evidence_package is not None else ""
        )
        required_data = _dedupe_data_requests([result])
        action_title = result.actions[0]
        action_detail = "；".join(result.actions[1:3]) if len(result.actions) > 1 else result.conclusion
        start_window = _start_window(priority)
        actions.append(
            DepartmentAction(
                id=f"{result.module}-action-1",
                department=result.module,
                department_label=skill_label(result.module),
                battle_goal=result.conclusion,
                priority=priority,
                action_title=action_title,
                action_detail=action_detail,
                owner_role=OWNER_ROLES.get(result.module, "业务负责人"),
                start_window=start_window,
                dependency=_dependency_note(result.module, primary, secondary),
                acceptance_rule=f"{start_window}后，能提供「{action_title}」的执行记录和指标变化。",
                required_data=required_data,
                metrics=[_metric_for(result.module)],
                risk_note=_risk_note(result, required_data, confidence),
                confidence=confidence,
                confidence_reason=confidence_reason,
                evidence_refs=_evidence_refs(result),
            )
        )
    return actions


def _priority_for(result: ModuleResult, primary: str, secondary: str) -> str:
    if result.module == primary:
        return "now"
    if result.module == secondary and result.signal in ("red", "yellow"):
        return "soon"
    if result.signal == "red":
        return "soon"
    return "later"


def _start_window(priority: str) -> str:
    if priority == "now":
        return "本周启动"
    if priority == "soon":
        return "两周内启动"
    return "一个月内排期"


def _dependency_note(module: str, primary: str, secondary: str) -> str:
    if module == primary:
        return "本期主战场，其他部门围绕该动作配合。"
    if module == secondary:
        return "本期次战场，需与主战场同步复盘。"
    return "按主战场进展排期，避免分散管理注意力。"


def _risk_note(
    result: ModuleResult, required_data: list[DataRequest], confidence: float | None
) -> str:
    if required_data:
        labels = "、".join(gap.label for gap in required_data[:2])
        return f"缺少{labels}时，该动作先按保守假设执行。"
    if confidence is not None and confidence < 0.65:
        return "当前证据置信度偏低，需在两周复盘时校验是否继续推进。"
    if result.signal == "green":
        return "当前不是核心瓶颈，避免过早投入过多资源。"
    return ""


def _evidence_refs(result: ModuleResult) -> list[str]:
    refs = [item.text for item in result.evidence[:2]]
    if result.evidence_package and result.evidence_package.benchmarks:
        benchmark = result.evidence_package.benchmarks[0]
        refs.append(f"{benchmark.name}：{benchmark.value}")
    return refs[:3]


def _decision_items(
    actions: list[DepartmentAction], primary: str, data_gaps: list[DataRequest]
) -> list[DecisionItem]:
    items: list[DecisionItem] = []
    for action in actions:
        if len(items) >= 2:
            break
        if action.priority in ("now", "soon"):
            items.append(
                DecisionItem(
                    title=f"拍板：{action.action_title}",
                    detail=f"是否授权{action.department_label}由{action.owner_role}牵头，{action.start_window}推进「{action.action_title}」。",
                    urgency=action.priority,
                )
            )
    if data_gaps and len(items) < 3:
        labels = "、".join(gap.label for gap in data_gaps[:2])
        items.append(
            DecisionItem(
                title="拍板：补齐关键数据",
                detail=f"是否立即补齐{labels}，用于把保守方案升级为可审计方案。",
                urgency="now",
            )
        )
    while len(items) < 3:
        primary_label = skill_label(primary)
        fallback_index = len(items) + 1
        if fallback_index == 1:
            title = f"拍板：把{primary_label}设为本期主战场"
            detail = f"是否把{primary_label}列为未来 30 天经营会的第一优先级。"
        elif fallback_index == 2:
            title = "拍板：允许两周试点"
            detail = "是否允许相关部门用两周窗口验证动作有效性，先看过程指标再决定加码。"
        else:
            title = "拍板：固定复盘节奏"
            detail = "是否按 7 天、14 天、30 天节点追动作、看指标、调优先级。"
        items.append(DecisionItem(title=title, detail=detail, urgency="soon"))
    return items[:3]


def _battle_chain(
    results: list[ModuleResult],
    primary: str,
    secondary: str,
    triage: TriageSummary,
) -> list[BattleChainStep]:
    modules: list[str] = []
    for module in [primary, secondary, *(result.module for result in results)]:
        if module and module not in modules:
            modules.append(module)
    if not modules:
        modules = ["overall"]

    steps: list[BattleChainStep] = []
    for index, module in enumerate(modules[:4]):
        dependency_note = triage.dependencies[index - 1] if index > 0 and index - 1 < len(triage.dependencies) else ""
        steps.append(
            BattleChainStep(
                id=module,
                label=CHAIN_LABELS.get(module, skill_label(module) if module != "overall" else "补齐经营输入"),
                depends_on=[steps[index - 1].id] if index > 0 else [],
                note=dependency_note,
            )
        )
    return steps


def _priority_board(actions: list[DepartmentAction]) -> PriorityBoard:
    board = PriorityBoard()
    for action in actions:
        getattr(board, action.priority).append(action.action_title)
    return board


def _evidence_summary(
    results: list[ModuleResult], primary: str, secondary: str
) -> list[str]:
    selected = [
        result
        for result in results
        if result.module in {module for module in (primary, secondary) if module}
    ] or results
    summary: list[str] = []
    for result in selected:
        for evidence in result.evidence[:2]:
            summary.append(f"{skill_label(result.module)}：{evidence.text}（{evidence.source}）")
        if result.evidence_package:
            for benchmark in result.evidence_package.benchmarks[:1]:
                summary.append(
                    f"{skill_label(result.module)}参考{benchmark.name}：{benchmark.value}"
                )
    if not summary:
        summary.append("当前证据不足，建议先补齐关键经营数据。")
    return summary[:5]


def _risk_summary(
    triage: TriageSummary,
    results: list[ModuleResult],
    data_gaps: list[DataRequest],
) -> list[str]:
    risks = [conflict.description for conflict in triage.conflicts[:2]]
    for result in results:
        if result.evidence_package and result.evidence_package.confidence < 0.65:
            risks.append(
                f"{skill_label(result.module)}证据置信度偏低，需先用复盘指标验证。"
            )
    for gap in data_gaps[:3]:
        risks.append(f"缺少{gap.label}，相关判断先按保守方案执行。")
    if not risks:
        risks.append("暂未发现重大冲突，但仍需按复盘节点校验动作有效性。")
    return risks[:5]


def _dedupe_data_requests(results: list[ModuleResult]) -> list[DataRequest]:
    collected: dict[str, DataRequest] = {}
    for result in results:
        for request in result.data_requests:
            collected.setdefault(request.key, request)
    return sorted(collected.values(), key=lambda request: (not request.required, request.key))


def _checkpoints(primary: str) -> list[ReviewCheckpoint]:
    primary_label = skill_label(primary) if primary else "主战场"
    return [
        ReviewCheckpoint(
            window="7d",
            title="7 天启动检查",
            checks=["关键数据是否补齐", "部门负责人是否确认", f"{primary_label}动作是否已经启动"],
        ),
        ReviewCheckpoint(
            window="14d",
            title="14 天过程复盘",
            checks=["过程指标是否出现变化", "跨部门依赖是否卡住", "是否继续保持当前主战场"],
        ),
        ReviewCheckpoint(
            window="30d",
            title="30 天验收与转向",
            checks=["核心目标是否改善", "哪些动作被证明确实有效", "下一轮应加码还是切换战场"],
        ),
    ]


def _find_result(results: list[ModuleResult], module: str) -> ModuleResult | None:
    for result in results:
        if result.module == module:
            return result
    return None
