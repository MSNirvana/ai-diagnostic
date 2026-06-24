from app.models.questionnaire import Questionnaire
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    DataRequest,
    Evidence,
    EvidencePackage,
    ExpertRoute,
    ModuleResult,
    TriageSummary,
)
from app.skills.skill_network import diagnosis_skill_definitions
from app.warroom.composer import OWNER_ROLES, compose_war_room_plan


def _result(
    module: str,
    signal: str,
    conclusion: str,
    actions: list[str],
    *,
    confidence: float,
    data_requests: list[DataRequest] | None = None,
) -> ModuleResult:
    return ModuleResult(
        module=module,
        signal=signal,  # type: ignore[arg-type]
        conclusion=conclusion,
        evidence=[
            Evidence(text=f"{module} 漏斗近 30 天恶化", source="经营数据"),
            Evidence(text=f"{module} 同行业对比偏弱", source="行业基准"),
        ],
        actions=actions,
        evidence_package=EvidencePackage(
            confidence=confidence,
            confidence_reason="样本覆盖核心链路",
            citations=[Evidence(text=f"{module} 原始报表", source="上传文件")],
            benchmarks=[
                BenchmarkReference(name=f"{module} 行业基准", source="公开研究", value="P50")
            ],
            audit_trail=AuditTrail(skill_version_id=f"{module}-v1", input_modules=[module]),
        ),
        data_requests=data_requests or [],
    )


def test_compose_war_room_plan_prefers_triage_primary_and_builds_decision_view():
    questionnaire = Questionnaire(
        project_id="proj_1",
        answers=[],
        problem_map={"goal": "30 天内提升高质量线索成交率"},
    )
    sales_gap = DataRequest(
        key="crm_conversion",
        label="CRM 阶段转化率",
        reason="需要验证线索在哪个阶段流失",
        source_hint="CRM",
    )
    results = [
        _result(
            "market",
            "yellow",
            "投放渠道质量不均衡",
            ["暂停低效渠道", "重配高意向渠道预算"],
            confidence=0.72,
        ),
        _result(
            "sales",
            "red",
            "销售承接速度慢导致高意向线索流失",
            ["重分线索池", "A 类线索 10 分钟内首响"],
            confidence=0.82,
            data_requests=[sales_gap],
        ),
    ]
    triage = TriageSummary(
        primary_module="sales",
        selected_experts=[
            ExpertRoute(module="sales", label="销售与增长", reason="问题地图建议优先诊断", priority=0),
            ExpertRoute(module="market", label="市场与客户", reason="渠道质量相关", priority=1),
        ],
        dependencies=["先确认目标客群与渠道质量，再优化销售转化动作。"],
        priority_actions=["销售与增长：重分线索池"],
    )

    plan = compose_war_room_plan(
        questionnaire,
        results,
        triage,
        {"sales": "sv_sales", "market": "sv_market"},
        record_id="rec_1",
    )

    assert plan.record_id == "rec_1"
    assert plan.project_id == "proj_1"
    assert plan.primary_battlefield == "sales"
    assert plan.secondary_battlefield == "market"
    assert "销售" in plan.summary
    assert plan.objective == "30 天内提升高质量线索成交率"
    assert plan.decision_items[0].urgency == "now"
    assert any("重分线索池" in item.detail for item in plan.decision_items)
    assert plan.battle_chain[0].id == "sales"
    assert plan.battle_chain[1].depends_on == ["sales"]


def test_compose_war_room_plan_maps_actions_gaps_priorities_and_checkpoints():
    shared_gap = DataRequest(
        key="ad_account",
        label="推广账号数据",
        reason="需要查看渠道消耗与转化",
        source_hint="巨量/百度/腾讯广告后台",
    )
    results = [
        _result(
            "market",
            "red",
            "渠道消耗结构失衡",
            ["拉取近 30 天推广账号数据", "暂停 CAC 超标渠道"],
            confidence=0.58,
            data_requests=[shared_gap],
        ),
        _result(
            "finance",
            "yellow",
            "预算边界不清晰",
            ["设置两周投放预算红线"],
            confidence=0.64,
            data_requests=[shared_gap],
        ),
        _result(
            "ops",
            "green",
            "交付暂未成为核心瓶颈",
            ["保持交付排期周检查"],
            confidence=0.76,
        ),
    ]
    plan = compose_war_room_plan(
        Questionnaire(answers=[]),
        results,
        TriageSummary(primary_module="market", dependencies=["渠道重配需要财务控制现金节奏。"]),
        {},
    )

    assert [gap.key for gap in plan.data_gaps] == ["ad_account"]
    assert plan.data_gaps[0].typical_owner == "市场负责人"
    assert plan.department_actions[0].department == "market"
    assert plan.department_actions[0].priority == "now"
    assert plan.department_actions[0].required_data[0].key == "ad_account"
    assert plan.department_actions[0].risk_note
    assert plan.department_actions[0].confidence_reason == "样本覆盖核心链路"
    assert "拉取近 30 天推广账号数据" in plan.priority_board.now
    # A：作战室只放有真信号(red)的域出部门卡；yellow(finance)/green(ops) 不再各摊一张卡，
    #    它们的缺数据归到「待补数据」与风险提示，避免一摊无关作业。
    assert {action.department for action in plan.department_actions} == {"market"}
    assert "设置两周投放预算红线" not in plan.priority_board.soon
    assert "保持交付排期周检查" not in plan.priority_board.later
    assert [checkpoint.window for checkpoint in plan.checkpoints] == ["7d", "14d", "30d"]
    assert any("推广账号数据" in risk for risk in plan.risk_summary)


def test_data_requests_keep_existing_owner_and_owner_mapping_covers_diagnosis_skills():
    owned_gap = DataRequest(
        key="campaign_budget",
        label="广告预算消耗",
        reason="需要核验真实投放效率",
        source_hint="广告后台",
        typical_owner="增长负责人",
    )
    plan = compose_war_room_plan(
        Questionnaire(answers=[]),
        [
            _result(
                "acquisition_efficiency",
                "red",
                "投放效率需要核验",
                ["拉取投放账号数据"],
                confidence=0.48,
                data_requests=[owned_gap],
            )
        ],
        TriageSummary(primary_module="acquisition_efficiency"),
        {},
    )

    assert plan.data_gaps[0].typical_owner == "增长负责人"
    missing = [
        definition.key
        for definition in diagnosis_skill_definitions()
        if definition.key not in OWNER_ROLES
    ]
    assert missing == []
