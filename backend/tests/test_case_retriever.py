"""相似案例检索测试：打分排序 / 标签匹配 / 排除自身 / 旁路容错 / 脱敏先例结构。"""
import json

import pytest
from sqlalchemy import select  # noqa: F401  保持与其它测试一致的导入风格

from app.cases.retriever import _score, _to_brief, retrieve_similar_cases
from app.db.models import CaseAsset


def _case(
    *,
    industry: str = "",
    scenario_key: str = "",
    primary_module: str = "",
    skills_used: list[str] | None = None,
    summary: dict | None = None,
    source_record_id: str | None = None,
) -> CaseAsset:
    return CaseAsset(
        source_record_id=source_record_id,
        industry=industry,
        scenario_key=scenario_key,
        primary_module=primary_module,
        skills_used_json=json.dumps(skills_used or [], ensure_ascii=False),
        diagnosis_summary_json=json.dumps(summary or {}, ensure_ascii=False),
        problem_map_json=json.dumps({"industry": industry}, ensure_ascii=False),
        data_gaps_json=json.dumps(["竞品基准"], ensure_ascii=False),
    )


# ---- 打分（纯函数）----

def test_score_same_module_strongest():
    case = _case(primary_module="sales")
    assert _score(case, "sales", "", "") == 4


def test_score_accumulates_tags():
    case = _case(
        industry="新能源厨电",
        scenario_key="channel_franchise",
        primary_module="channel_franchise",
        skills_used=["channel_franchise"],
    )
    # 主战场4 + 场景3 + 行业2 + skills命中1 = 10
    assert _score(case, "channel_franchise", "新能源厨电", "channel_franchise") == 10


def test_score_zero_when_nothing_matches():
    case = _case(industry="教育", scenario_key="edu", primary_module="finance")
    assert _score(case, "sales", "餐饮", "channel_franchise") == 0


# ---- 精简先例结构 ----

def test_to_brief_extracts_module_finding():
    case = _case(
        industry="新能源厨电",
        scenario_key="channel_franchise",
        primary_module="channel_franchise",
        summary={
            "channel_franchise": {"signal": "red", "conclusion": "招商转化偏低", "confidence": 0.7},
            "finance": {"signal": "green", "conclusion": "现金流健康", "confidence": 0.8},
        },
    )
    brief = _to_brief(case, "channel_franchise")
    assert brief["module_finding"]["signal"] == "red"
    assert brief["industry"] == "新能源厨电"
    assert "channel_franchise" in brief["all_findings"]
    assert brief["data_gaps"] == ["竞品基准"]


# ---- 检索落库行为 ----

@pytest.mark.asyncio
async def test_retrieve_ranks_by_similarity(db_session):
    async with db_session() as session:
        # 强相关：同行业同场景同主战场（10分）
        session.add(_case(industry="新能源厨电", scenario_key="channel_franchise",
                          primary_module="channel_franchise", skills_used=["channel_franchise"],
                          summary={"channel_franchise": {"signal": "red", "conclusion": "招商慢"}}))
        # 中相关：同行业同场景但主战场不同（场景3+行业2=5分，过门槛）
        session.add(_case(industry="新能源厨电", scenario_key="channel_franchise", primary_module="market"))
        # 弱相关：只同行业（2分，低于门槛被丢）
        session.add(_case(industry="新能源厨电", scenario_key="dtc", primary_module="finance"))
        # 不相关：完全不同（0分）
        session.add(_case(industry="教育", scenario_key="edu", primary_module="finance"))
        await session.commit()

        cases = await retrieve_similar_cases(
            session, module="channel_franchise",
            industry="新能源厨电", scenario_key="channel_franchise",
        )
        assert len(cases) == 2  # 仅同行业(2分)和不相关(0分)都被门槛挡掉
        # 最相似的排第一
        assert cases[0]["primary_module"] == "channel_franchise"
        assert cases[0]["module_finding"]["signal"] == "red"


@pytest.mark.asyncio
async def test_retrieve_drops_below_threshold(db_session):
    """只同行业（弱相关，2分 < MIN_SCORE）不应被当作先例注入——宁缺毋滥。"""
    async with db_session() as session:
        # 同行业，但模块和场景都不同：仅 +2 分
        session.add(_case(industry="餐饮", scenario_key="dtc", primary_module="market"))
        await session.commit()
        cases = await retrieve_similar_cases(
            session, module="channel_franchise", industry="餐饮", scenario_key="channel_franchise",
        )
        assert cases == []  # 低于门槛，宁可返回空也不硬凑


@pytest.mark.asyncio
async def test_retrieve_industry_plus_skill_passes_threshold(db_session):
    """同行业(+2) + skills命中(+1) = 3 分，刚好达门槛，应被召回。"""
    async with db_session() as session:
        session.add(_case(industry="餐饮", scenario_key="dtc", primary_module="market",
                          skills_used=["channel_franchise"]))
        await session.commit()
        cases = await retrieve_similar_cases(
            session, module="channel_franchise", industry="餐饮", scenario_key="channel_franchise",
        )
        assert len(cases) == 1


@pytest.mark.asyncio
async def test_retrieve_excludes_self(db_session):
    async with db_session() as session:
        session.add(_case(industry="餐饮", scenario_key="channel_franchise",
                          primary_module="channel_franchise", source_record_id="rec_self"))
        await session.commit()
        cases = await retrieve_similar_cases(
            session, module="channel_franchise", industry="餐饮",
            scenario_key="channel_franchise", exclude_record_id="rec_self",
        )
        assert cases == []  # 唯一候选是自己，被排除


@pytest.mark.asyncio
async def test_retrieve_empty_when_no_cases(db_session):
    async with db_session() as session:
        cases = await retrieve_similar_cases(session, module="sales", industry="餐饮")
        assert cases == []


@pytest.mark.asyncio
async def test_retrieve_respects_limit(db_session):
    async with db_session() as session:
        for _ in range(5):
            session.add(_case(industry="餐饮", scenario_key="channel_franchise",
                              primary_module="channel_franchise"))
        await session.commit()
        cases = await retrieve_similar_cases(
            session, module="channel_franchise", industry="餐饮",
            scenario_key="channel_franchise", limit=2,
        )
        assert len(cases) == 2


# ---- 旁路容错 ----

@pytest.mark.asyncio
async def test_retrieve_none_session_returns_empty():
    assert await retrieve_similar_cases(None, module="sales") == []


@pytest.mark.asyncio
async def test_retrieve_empty_module_returns_empty(db_session):
    async with db_session() as session:
        assert await retrieve_similar_cases(session, module="") == []
