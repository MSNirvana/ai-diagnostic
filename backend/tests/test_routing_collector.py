"""Loop 2 路由样本收集器测试：写入 / 漏召回检测 / 无session跳过 / 异常不影响诊断。"""
import json

import pytest
from sqlalchemy import select

from app.orchestrator.dispatcher import diagnose_all
from app.db.models import RoutingSample
from app.models.questionnaire import Questionnaire, ModuleAnswer


class FakeLLM:
    """按模块返回可控信号，便于断言路由结果。"""

    def __init__(self, signal_by_module: dict[str, str] | None = None):
        self._map = signal_by_module or {}

    async def complete(self, system: str, prompt: str) -> str:
        signal = "yellow"
        for module, sig in self._map.items():
            if f'"module": "{module}"' in prompt:
                signal = sig
                break
        return json.dumps({
            "signal": signal,
            "conclusion": f"结论-{signal}",
            "evidence": [{"text": "线索成本45元偏高", "source": "经营数据"}],
            "actions": ["暂停低效渠道"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


@pytest.mark.asyncio
async def test_writes_routing_sample(db_session):
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["获客贵"])])
    async with db_session() as session:
        await diagnose_all(q, llm=FakeLLM({"market": "red"}), session=session)
        rows = list(await session.scalars(select(RoutingSample)))

    assert len(rows) == 1
    sample = rows[0]
    selected = json.loads(sample.selected_json)
    outcomes = json.loads(sample.outcomes_json)
    assert any(s["module"] == "market" and s["source"] == "user_filled" for s in selected)
    assert any(o["module"] == "market" and o["signal"] == "red" for o in outcomes)


@pytest.mark.asyncio
async def test_detects_missed_recall(db_session):
    # market 手填 + 诊断 red，但 problem_text 里没有任何关键词 → 关键词漏召回
    q = Questionnaire(answers=[ModuleAnswer(module="market")])
    async with db_session() as session:
        await diagnose_all(q, llm=FakeLLM({"market": "red"}), session=session)
        rows = list(await session.scalars(select(RoutingSample)))

    missed = json.loads(rows[0].missed_json)
    assert "market" in missed


@pytest.mark.asyncio
async def test_no_missed_when_green(db_session):
    # 手填但回 green，不算漏召回（不是真问题）
    q = Questionnaire(answers=[ModuleAnswer(module="market")])
    async with db_session() as session:
        await diagnose_all(q, llm=FakeLLM({"market": "green"}), session=session)
        rows = list(await session.scalars(select(RoutingSample)))

    assert json.loads(rows[0].missed_json) == []


@pytest.mark.asyncio
async def test_none_session_skips_silently():
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["获客贵"])])
    # session=None：不应报错，诊断正常返回
    outcome = await diagnose_all(q, llm=FakeLLM({"market": "red"}), session=None)
    assert outcome.results[0].module == "market"


@pytest.mark.asyncio
async def test_collector_swallows_db_error(db_session, monkeypatch):
    # 让 commit 抛错，验证收集器内部吞掉、诊断仍正常返回
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["获客贵"])])
    async with db_session() as session:
        async def boom():
            raise RuntimeError("db down")

        monkeypatch.setattr(session, "commit", boom)
        try:
            outcome = await diagnose_all(q, llm=FakeLLM({"market": "red"}), session=session)
        except RuntimeError:
            pytest.fail("收集器写库异常不应冒泡到诊断")
    assert outcome.results[0].module == "market"
