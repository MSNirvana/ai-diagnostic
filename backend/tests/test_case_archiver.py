"""Loop 3 案例归档测试：脱敏 / 结构完整 / 失败不影响诊断 / 匿名也归档。"""
import json

import pytest
from sqlalchemy import select

from app.cases.anonymizer import anonymize_profile, fuzz_numbers
from app.cases.archiver import _build_case_asset, archive_case
from app.db.models import CaseAsset
from app.models.questionnaire import Questionnaire
from app.models.result import (
    AuditTrail,
    Evidence,
    EvidencePackage,
    ModuleResult,
    TriageSummary,
)


def _result(module: str, signal: str, conclusion: str) -> ModuleResult:
    return ModuleResult(
        module=module,
        signal=signal,  # type: ignore[arg-type]
        conclusion=conclusion,
        evidence=[Evidence(text="样本证据", source="经营数据")],
        actions=["暂停低效渠道"],
        evidence_package=EvidencePackage(
            confidence=0.7,
            confidence_reason="x",
            citations=[],
            benchmarks=[],
            audit_trail=AuditTrail(skill_version_id=f"{module}-v1", input_modules=[module]),
        ),
        data_requests=[],
    )


def _questionnaire():
    return Questionnaire(
        answers=[],
        problem_map={
            "company_name": "花火电器有限公司",
            "industry": "新能源厨电",
            "scenario_key": "channel_franchise",
            "月营收": "1200万元",
            "goal": "30天内提升招商转化",
        },
    )


# ---- 脱敏单元 ----

def test_fuzz_numbers_buckets_money_keeps_kpi():
    assert "100-500万" in fuzz_numbers("月营收180万")
    assert "8%" in fuzz_numbers("转化率8%")  # 百分比/KPI 保留


def test_anonymize_profile_drops_company_name():
    out = anonymize_profile({"company_name": "花火电器", "industry": "新能源厨电", "月营收": "1200万元"})
    assert "company_name" not in out
    assert out["industry"] == "新能源厨电"          # 行业标签保留
    assert "1200" not in out["月营收"]               # 精确数字抹掉


# ---- 归档组装（纯函数）----

def test_build_case_asset_structure_and_anonymized():
    results = [_result("channel_franchise", "red", "招商转化率仅12%，单店回本26个月偏慢")]
    case = _build_case_asset(_questionnaire(), results, TriageSummary(primary_module="channel_franchise"), "rec_1")

    assert case.industry == "新能源厨电"
    assert case.primary_module == "channel_franchise"
    assert case.source_record_id == "rec_1"
    # 项目名不得出现在任何脱敏字段里
    assert "花火" not in case.company_profile_json
    assert "花火" not in case.problem_map_json
    # 诊断摘要结构完整
    summary = json.loads(case.diagnosis_summary_json)
    assert summary["channel_franchise"]["signal"] == "red"
    skills = json.loads(case.skills_used_json)
    assert skills == ["channel_franchise"]


# ---- 落库 + 旁路容错 ----

@pytest.mark.asyncio
async def test_archive_persists_to_db(db_session):
    async with db_session() as session:
        results = [_result("market", "red", "获客成本翻倍")]
        case = await archive_case(session, _questionnaire(), results, TriageSummary(primary_module="market"), "rec_x")
        assert case is not None
        rows = (await session.scalars(select(CaseAsset))).all()
        assert len(rows) == 1
        assert rows[0].industry == "新能源厨电"


@pytest.mark.asyncio
async def test_archive_none_session_returns_none():
    # session 为 None（匿名无库场景）不报错
    out = await archive_case(None, _questionnaire(), [_result("market", "red", "x的结论够长")], TriageSummary())
    assert out is None


@pytest.mark.asyncio
async def test_archive_empty_results_returns_none(db_session):
    async with db_session() as session:
        out = await archive_case(session, _questionnaire(), [], TriageSummary())
        assert out is None  # 没结果不归档，但也不崩
