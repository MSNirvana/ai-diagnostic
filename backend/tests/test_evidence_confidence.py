from app.models.questionnaire import ModuleAnswer
from app.models.result import DataRequest, Evidence
from app.skills.evidence import build_evidence_package
from scripts.seed_skills import SEEDS


def test_confidence_varies_by_evidence_quality_and_data_gaps():
    weak = build_evidence_package(
        module="market",
        answer=ModuleAnswer(module="market", facts={}, pains=["获客成本高"]),
        benchmark={"benchmark": {"note": "external benchmark placeholder"}},
        citations=[Evidence(text="获客成本可能偏高", source="分析")],
        actions=["继续观察"],
        skill_version_id="market-v1",
        evidence_skill_version_id="confidence-v1",
        data_requests=[
            DataRequest(
                key="promotion_account",
                label="推广账号与广告平台",
                reason="缺少账号无法核验投放情况。",
                required=True,
            ),
            DataRequest(
                key="campaign_performance",
                label="近90天投放表现",
                reason="缺少花费、点击和转化数据。",
                required=True,
            ),
        ],
    )

    strong = build_evidence_package(
        module="market",
        answer=ModuleAnswer(
            module="market",
            facts={
                "近90天花费": "90天广告花费120万元，CAC 420元。",
                "转化率": "线索到成交转化率从8%降到4.5%。",
                "账号结构": "巨量60%，小红书25%，百度15%。",
            },
            pains=["获客成本高"],
            uploaded_files=["巨量广告后台_近90天投放报表.xlsx"],
            context={"core_problem": "获客成本翻倍但成交没增长"},
        ),
        benchmark={"benchmark": {"行业CAC中位数": "180元", "样本来源": "公开行业报告2026"}},
        citations=[
            Evidence(text="近90天广告花费120万元，CAC 420元。", source="上传投放报表"),
            Evidence(text="线索到成交转化率从8%降到4.5%。", source="CRM销售漏斗"),
            Evidence(text="行业CAC中位数约180元。", source="行业报告2026"),
        ],
        actions=["7天内按账号重算CAC并关闭低效计划", "两周后复盘渠道成交率"],
        skill_version_id="market-v1",
        evidence_skill_version_id="confidence-v1",
        data_requests=[],
    )

    assert weak.confidence < strong.confidence
    assert weak.confidence <= 0.78
    assert strong.confidence >= 0.75
    assert strong.confidence != 0.92
    assert any("证据置信度Skill版本: confidence-v1" in check for check in strong.audit_trail.checks)
    assert "缺少 2 类必需数据" in weak.confidence_reason
    assert "仅有占位基准" in weak.confidence_reason
    assert "已接入外部基准" in strong.confidence_reason


def test_evidence_confidence_skill_is_seeded_for_iteration():
    seeded = {module: (skill_type, method, prompt) for module, skill_type, method, prompt in SEEDS}

    assert "evidence_confidence" in seeded
    skill_type, method, prompt = seeded["evidence_confidence"]
    assert skill_type == "delivery"
    assert method == "confidence_calibration"
    assert "禁止固定高分" in prompt


def test_archive_extraction_skill_is_seeded_for_iteration():
    seeded = {module: (skill_type, method, prompt) for module, skill_type, method, prompt in SEEDS}

    assert "archive_extraction" in seeded
    skill_type, method, prompt = seeded["archive_extraction"]
    assert skill_type == "delivery"
    assert method == "archive_extraction"
    assert "报告性质" in prompt
    assert "参与人" in prompt


def test_archive_refinement_skill_is_seeded_for_iteration():
    seeded = {module: (skill_type, method, prompt) for module, skill_type, method, prompt in SEEDS}

    assert "archive_refinement" in seeded
    skill_type, method, prompt = seeded["archive_refinement"]
    assert skill_type == "delivery"
    assert method == "archive_refinement"
    assert "不直接摘抄" in prompt
    assert "按领域归档" in prompt
    assert "display.type" in prompt
